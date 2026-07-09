import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Household, HouseholdDocument } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdMemberDocument,
  HouseholdRole,
  MembershipStatus,
} from './schemas/household-member.schema';
import {
  Invitation,
  InvitationDocument,
  InvitationStatus,
} from './schemas/invitation.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateHouseholdDto } from './dto/create-household.dto';
import { UpdateHouseholdDto } from './dto/update-household.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';
import type { HouseholdContext } from './interfaces/household-request.interface';
import { CategoriesService } from '../categories/categories.service';

export interface AddMemberParams {
  householdId: string;
  userId: string;
  role: HouseholdRole;
  status?: MembershipStatus;
}

// Sanitized invitation view returned to the inviting owner. Includes the
// shareable `inviteUrl` (raw token) so the owner can copy/send the link
// directly, and deliberately omits `tokenHash`.
export interface InviteResult {
  id: string;
  householdId: string;
  email: string;
  role: HouseholdRole;
  status: InvitationStatus;
  expiresAt: Date;
  inviteUrl: string;
}

// How long an invitation token stays valid. Longer than the 1h password-reset
// window because an invitee may need to register an account before accepting.
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class HouseholdsService {
  private readonly logger = new Logger(HouseholdsService.name);

  constructor(
    @InjectModel(Household.name)
    private householdModel: Model<HouseholdDocument>,
    @InjectModel(HouseholdMember.name)
    private memberModel: Model<HouseholdMemberDocument>,
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private configService: ConfigService,
    @Inject(MAIL_SERVICE) private mailService: MailService,
    private categoriesService: CategoriesService,
  ) {}

  /**
   * Create a household owned by `ownerId` and add that user as the active
   * `owner` member. Intended as the canonical entry point for registration and
   * the data migration (wired up in follow-up tickets).
   */
  async createHousehold(
    ownerId: string,
    dto: CreateHouseholdDto,
  ): Promise<HouseholdDocument> {
    const household = new this.householdModel({
      name: dto.name,
      ownerId: new Types.ObjectId(ownerId),
      currency: dto.currency ?? 'USD',
    });
    const saved = await household.save();

    // The household and its owner membership are two separate writes (no
    // transaction, matching the rest of the service layer). If the membership
    // fails the household would be left ownerless and unreachable, so delete it
    // best-effort and surface the original error.
    try {
      await this.addMember({
        householdId: saved._id.toString(),
        userId: ownerId,
        role: HouseholdRole.OWNER,
        status: MembershipStatus.ACTIVE,
      });
    } catch (error) {
      this.logger.error(
        { householdId: saved._id.toString(), ownerId },
        'Owner membership failed; deleting orphaned household',
      );
      await this.householdModel
        .deleteOne({ _id: saved._id } as Record<string, unknown>)
        .catch(() => undefined);
      throw error;
    }

    // Seed the household's default categories so transactions have something to
    // categorize against from day one. Best-effort: a failure here must not undo
    // a successfully-created household (categories are repairable), so it's
    // logged and the idempotent startup backfill re-runs the seed next boot.
    try {
      await this.categoriesService.seedDefaultsForHousehold(
        saved._id.toString(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { householdId: saved._id.toString() },
        `Default category seeding failed; will be backfilled at startup: ${message}`,
      );
    }

    this.logger.log(
      { householdId: saved._id.toString(), ownerId },
      'Household created',
    );
    return saved;
  }

  /**
   * Add a member to a household. Active memberships are stamped with a
   * `joinedAt`; invited ones are not (they join on acceptance). Throws
   * ConflictException if the user is already a member of the household, or
   * already has an active membership in another household.
   */
  async addMember(params: AddMemberParams): Promise<HouseholdMemberDocument> {
    const status = params.status ?? MembershipStatus.ACTIVE;
    const member = new this.memberModel({
      householdId: new Types.ObjectId(params.householdId),
      userId: new Types.ObjectId(params.userId),
      role: params.role,
      status,
      joinedAt: status === MembershipStatus.ACTIVE ? new Date() : undefined,
    });

    try {
      return await member.save();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        // Two unique indexes can fire here: (householdId, userId) — already a
        // member of THIS household — and the userId-only partial index, which
        // fires when the user already has an ACTIVE membership (in the
        // non-overlapping case, one in another household). Match both known
        // shapes explicitly; anything else gets a generic conflict rather
        // than a specific claim that may be false.
        const keyPattern =
          (error as { keyPattern?: Record<string, number> }).keyPattern ?? {};
        if (keyPattern.userId === 1 && !('householdId' in keyPattern)) {
          throw new ConflictException('User already has an active household');
        }
        if (keyPattern.householdId === 1 && keyPattern.userId === 1) {
          throw new ConflictException(
            'User is already a member of this household',
          );
        }
        this.logger.error(
          `addMember duplicate-key error with unrecognized keyPattern ` +
            `${JSON.stringify(keyPattern)}: ${error.message}`,
        );
        throw new ConflictException(
          'Membership conflicts with an existing membership',
        );
      }
      throw error;
    }
  }

  /**
   * Find a user's active household membership. Returns null if the user has no
   * active membership. Will be used by the HouseholdGuard to resolve the
   * caller's active household.
   */
  async findMembershipByUser(
    userId: string,
  ): Promise<HouseholdMemberDocument | null> {
    return this.memberModel
      .findOne({
        userId: new Types.ObjectId(userId),
        status: MembershipStatus.ACTIVE,
      } as Record<string, unknown>)
      .exec();
  }

  /**
   * Delete every household membership for a user (across all households).
   * Used by the user-deletion cascade: the user's memberships go, but the
   * households and their shared data remain. Returns the number removed.
   */
  async removeMembershipsByUser(userId: string): Promise<number> {
    const result = await this.memberModel
      .deleteMany({ userId: new Types.ObjectId(userId) } as Record<
        string,
        unknown
      >)
      .exec();
    return result.deletedCount;
  }

  // ---------------------------------------------------------------------------
  // VEG-390 — household management + member-invitation API.
  // Owner-gated methods take the HouseholdContext that HouseholdGuard resolved
  // and attached to `req.household` (householdId + role come from the same
  // trusted source, never client input) and re-assert the role server-side.
  // ---------------------------------------------------------------------------

  /** Fetch a household plus its members (with user display info populated). */
  async getHouseholdWithMembers(householdId: string): Promise<{
    household: HouseholdDocument;
    members: HouseholdMemberDocument[];
  }> {
    const household = await this.householdModel.findById(householdId).exec();
    if (!household) {
      throw new NotFoundException('Household not found');
    }
    const members = await this.listMembers(householdId);
    return { household, members };
  }

  /** List a household's members, each with the user's display fields populated. */
  async listMembers(householdId: string): Promise<HouseholdMemberDocument[]> {
    return this.memberModel
      .find({ householdId: new Types.ObjectId(householdId) } as Record<
        string,
        unknown
      >)
      .populate('userId', 'username displayName email')
      .exec();
  }

  /** Update a household's name/currency. Owner-only. */
  async updateHousehold(
    ctx: HouseholdContext,
    dto: UpdateHouseholdDto,
  ): Promise<HouseholdDocument> {
    this.assertOwner(ctx.role);
    const updated = await this.householdModel
      .findByIdAndUpdate(ctx.householdId, dto, {
        new: true,
        runValidators: true,
      })
      .exec();
    if (!updated) {
      throw new NotFoundException('Household not found');
    }
    return updated;
  }

  /**
   * Invite someone to a household by email. Owner-only. Creates a hashed,
   * expiring Invitation and sends the raw token by email (fire-and-forget,
   * mirroring the password-reset flow). Re-inviting the same email supersedes
   * any prior pending invitation for that household.
   */
  async inviteMember(
    ctx: HouseholdContext,
    dto: InviteMemberDto,
  ): Promise<InviteResult> {
    this.assertOwner(ctx.role);

    const householdId = ctx.householdId;
    const email = dto.email.toLowerCase();
    const invitedRole = dto.role ?? HouseholdRole.ADULT;

    // Reject inviting someone who is already an active member.
    const existingUser = await this.userModel
      .findOne({ email } as Record<string, unknown>)
      .exec();
    if (existingUser) {
      const membership = await this.memberModel
        .findOne({
          householdId: new Types.ObjectId(householdId),
          userId: existingUser._id,
          status: MembershipStatus.ACTIVE,
        } as Record<string, unknown>)
        .exec();
      if (membership) {
        throw new ConflictException(
          'That user is already a member of this household',
        );
      }
    }

    // Supersede any outstanding pending invitations for the same email so only
    // the newest token is valid (mirrors the password-reset invalidation).
    await this.invitationModel
      .updateMany(
        {
          householdId: new Types.ObjectId(householdId),
          email,
          status: InvitationStatus.PENDING,
        } as Record<string, unknown>,
        { status: InvitationStatus.REVOKED },
      )
      .exec();

    const plainToken = crypto.randomBytes(32).toString('hex');
    const invitation = await new this.invitationModel({
      householdId: new Types.ObjectId(householdId),
      email,
      tokenHash: this.hashToken(plainToken),
      role: invitedRole,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    }).save();

    const household = await this.householdModel.findById(householdId).exec();
    if (!household) {
      // The household was just resolved by HouseholdGuard and we wrote an
      // invitation scoped to it, so a null here is a real data-integrity
      // anomaly (deleted out from under us / replica lag) — surface it rather
      // than silently emailing an invite to "your household".
      this.logger.warn(
        { householdId },
        'Household not found while composing invitation email',
      );
    }
    const householdName = household?.name ?? 'your household';
    const frontendUrl =
      this.configService.get<string>('frontendUrl') || 'http://localhost:3000';
    const inviteUrl = `${frontendUrl}/household/accept?token=${plainToken}`;

    const invitationId = invitation._id.toString();
    void this.mailService
      .sendInvitationEmail(email, inviteUrl, householdName)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // Include ids so the dangling PENDING invitation is correlatable.
        this.logger.error(
          { householdId, invitationId },
          `Failed to send invitation email: ${message}`,
        );
      });

    this.logger.log(
      { householdId, invitationId },
      'Household invitation created',
    );

    // Return the raw token (via inviteUrl) only to the owner who created the
    // invite, so the UI can offer a copy-able link; never expose the tokenHash.
    return {
      id: invitationId,
      householdId,
      email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviteUrl,
    };
  }

  /**
   * Accept an invitation by raw token. The caller must be authenticated and
   * their account email must match the invited email. Accepting switches the
   * user's active household to the invited one: their existing active membership
   * (their personal household) is mutated in place to the invited household and
   * role, preserving the "one active membership per user" invariant.
   */
  async acceptInvitation(
    userId: string,
    token: string,
  ): Promise<HouseholdMemberDocument> {
    const invitation = await this.invitationModel
      .findOne({
        tokenHash: this.hashToken(token),
        status: InvitationStatus.PENDING,
        expiresAt: { $gt: new Date() },
      } as Record<string, unknown>)
      .exec();
    if (!invitation) {
      throw new BadRequestException('Invalid or expired invitation');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user || !user.email || user.email !== invitation.email) {
      // The invite is addressed to a specific email; don't let an unrelated
      // (or email-less) account redeem a leaked token.
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    const householdId = invitation.householdId as unknown as Types.ObjectId;

    // Already an ACTIVE member of the invited household — accept idempotently.
    // Filtered to ACTIVE so a stale non-active row can't short-circuit a real
    // join (which would burn the token while leaving the user un-switched).
    const existingActive = await this.memberModel
      .findOne({
        householdId,
        userId: user._id,
        status: MembershipStatus.ACTIVE,
      } as Record<string, unknown>)
      .exec();
    if (existingActive) {
      await this.markAccepted(invitation);
      return this.populateMember(existingActive);
    }

    // Switch the user's active household in place (or create one if somehow
    // absent). Mutating the existing row keeps a single active membership.
    const active = await this.findMembershipByUser(userId);
    let membership: HouseholdMemberDocument;
    if (active) {
      // Don't strand a shared household: an owner leaving a household that has
      // other members would leave it with no owner (permanently unmanageable).
      if (active.role === HouseholdRole.OWNER) {
        const others = await this.memberModel
          .countDocuments({
            householdId: active.householdId,
            userId: { $ne: user._id },
          } as Record<string, unknown>)
          .exec();
        if (others > 0) {
          throw new ConflictException(
            'You own a household with other members. Remove them or transfer ' +
              'ownership before joining another household.',
          );
        }
      }

      active.householdId = householdId as unknown as typeof active.householdId;
      active.role = invitation.role;
      active.joinedAt = new Date();
      membership = await this.saveSwitch(active);
    } else {
      membership = await this.addMember({
        householdId: householdId.toString(),
        userId,
        role: invitation.role,
        status: MembershipStatus.ACTIVE,
      });
    }

    await this.markAccepted(invitation);
    this.logger.log(
      { householdId: householdId.toString(), userId },
      'Household invitation accepted',
    );
    return this.populateMember(membership);
  }

  // Return the membership with its user populated (username/displayName/email),
  // matching the shape of the members list so the accept response is a faithful
  // HouseholdMember. Falls back to the bare doc if the row can't be re-read.
  private async populateMember(
    member: HouseholdMemberDocument,
  ): Promise<HouseholdMemberDocument> {
    const populated = await this.memberModel
      .findById(member._id)
      .populate('userId', 'username displayName email')
      .exec();
    return populated ?? member;
  }

  /**
   * Remove a member from a household. Owner-only; the owner cannot be removed.
   * The removed user is re-provisioned a personal household so they aren't
   * locked out of every household-scoped route (HouseholdGuard needs an active
   * membership). Shared data stays with the household they left.
   */
  async removeMember(ctx: HouseholdContext, memberId: string): Promise<void> {
    this.assertOwner(ctx.role);

    const member = await this.memberModel.findById(memberId).exec();
    if (
      !member ||
      (member.householdId as unknown as Types.ObjectId).toString() !==
        ctx.householdId
    ) {
      throw new NotFoundException('Member not found');
    }
    if (member.role === HouseholdRole.OWNER) {
      throw new ForbiddenException('Cannot remove the household owner');
    }

    const removedUserId = (
      member.userId as unknown as Types.ObjectId
    ).toString();
    await this.memberModel
      .deleteOne({ _id: member._id } as Record<string, unknown>)
      .exec();

    await this.provisionPersonalHousehold(removedUserId);
  }

  /**
   * Create a fresh personal household + active owner membership for a user who
   * would otherwise have no active household (e.g. after being removed from a
   * shared one). Mirrors the naming used at registration. Best-effort: a failure
   * here must not undo the removal, so it is logged rather than thrown.
   */
  private async provisionPersonalHousehold(userId: string): Promise<void> {
    try {
      const user = await this.userModel.findById(userId).exec();
      const label = user?.displayName?.trim() || user?.username || 'My';
      await this.createHousehold(userId, { name: `${label}'s Household` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { userId },
        `Failed to re-provision personal household after removal: ${message}`,
      );
    }
  }

  /**
   * Persist an in-place active-household switch, translating a duplicate-key
   * error (the user already has a row for the target household) into a clean
   * ConflictException instead of a raw Mongo 500 — mirrors addMember.
   */
  private async saveSwitch(
    member: HouseholdMemberDocument,
  ): Promise<HouseholdMemberDocument> {
    try {
      return await member.save();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictException(
          'You are already a member of that household',
        );
      }
      throw error;
    }
  }

  private assertOwner(role: HouseholdRole): void {
    if (role !== HouseholdRole.OWNER) {
      throw new ForbiddenException(
        'Only the household owner can perform this action',
      );
    }
  }

  private async markAccepted(invitation: InvitationDocument): Promise<void> {
    invitation.status = InvitationStatus.ACCEPTED;
    await invitation.save();
  }

  // HMAC (keyed hash) so a leaked DB dump of token hashes can't be brute-forced
  // without the server-side pepper — identical to the auth token pattern.
  private hashToken(plain: string): string {
    const pepper = this.configService.get<string>('auth.tokenPepper') ?? '';
    return crypto.createHmac('sha256', pepper).update(plain).digest('hex');
  }
}
