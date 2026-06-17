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

export interface AddMemberParams {
  householdId: string;
  userId: string;
  role: HouseholdRole;
  status?: MembershipStatus;
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

    this.logger.log(
      { householdId: saved._id.toString(), ownerId },
      'Household created',
    );
    return saved;
  }

  /**
   * Add a member to a household. Active memberships are stamped with a
   * `joinedAt`; invited ones are not (they join on acceptance). Throws
   * ConflictException if the user is already a member of the household.
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
        throw new ConflictException(
          'User is already a member of this household',
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
  // Methods below assume the caller's active household has already been resolved
  // by HouseholdGuard; `householdId`/`role` come from `req.household`, never from
  // client input. Owner-gated operations re-assert the role server-side.
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
    householdId: string,
    role: HouseholdRole,
    dto: UpdateHouseholdDto,
  ): Promise<HouseholdDocument> {
    this.assertOwner(role);
    const updated = await this.householdModel
      .findByIdAndUpdate(householdId, dto, { new: true, runValidators: true })
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
    householdId: string,
    role: HouseholdRole,
    dto: InviteMemberDto,
  ): Promise<InvitationDocument> {
    this.assertOwner(role);

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
    const householdName = household?.name ?? 'your household';
    const frontendUrl =
      this.configService.get<string>('frontendUrl') || 'http://localhost:3000';
    const inviteUrl = `${frontendUrl}/invitations/accept?token=${plainToken}`;

    void this.mailService
      .sendInvitationEmail(email, inviteUrl, householdName)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to send invitation email: ${message}`);
      });

    this.logger.log(
      { householdId, invitationId: invitation._id.toString() },
      'Household invitation created',
    );
    return invitation;
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

    // Already linked to the invited household — accept idempotently.
    const existingLink = await this.memberModel
      .findOne({
        householdId,
        userId: user._id,
      } as Record<string, unknown>)
      .exec();
    if (existingLink) {
      await this.markAccepted(invitation);
      return existingLink;
    }

    // Switch the user's active household in place (or create one if somehow
    // absent). Mutating the existing row keeps a single active membership.
    const active = await this.findMembershipByUser(userId);
    let membership: HouseholdMemberDocument;
    if (active) {
      active.householdId = householdId as never;
      active.role = invitation.role;
      active.joinedAt = new Date();
      membership = await active.save();
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
    return membership;
  }

  /** Remove a member from a household. Owner-only; the owner cannot be removed. */
  async removeMember(
    householdId: string,
    role: HouseholdRole,
    memberId: string,
  ): Promise<void> {
    this.assertOwner(role);

    const member = await this.memberModel.findById(memberId).exec();
    if (
      !member ||
      (member.householdId as unknown as Types.ObjectId).toString() !==
        householdId
    ) {
      throw new NotFoundException('Member not found');
    }
    if (member.role === HouseholdRole.OWNER) {
      throw new ForbiddenException('Cannot remove the household owner');
    }

    await this.memberModel
      .deleteOne({ _id: member._id } as Record<string, unknown>)
      .exec();
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
