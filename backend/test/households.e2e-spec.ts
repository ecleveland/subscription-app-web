import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * Register a user (each gets their own personal household) and return a Bearer
 * token plus the email used.
 */
async function register(
  app: INestApplication<App>,
  username: string,
): Promise<{ token: string; email: string }> {
  const email = `${username}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ username, password: 'Password123', email })
    .expect(201);
  return { token: res.body.access_token, email };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Households (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  /**
   * Invite an email to the owner's household and return the raw token. The
   * invite response carries a shareable `inviteUrl` (the "copy invite link"
   * contract the frontend depends on); the raw token rides in that URL.
   */
  async function invite(
    ownerToken: string,
    email: string,
    role?: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/households/me/invitations')
      .set(auth(ownerToken))
      .send({ email, ...(role ? { role } : {}) })
      .expect(201);

    const inviteUrl = res.body.inviteUrl as string;
    return new URL(inviteUrl).searchParams.get('token') as string;
  }

  describe('GET /households/me', () => {
    it('returns the active household and the owner member', async () => {
      const owner = await register(app, 'owner1');

      const res = await request(app.getHttpServer())
        .get('/api/households/me')
        .set(auth(owner.token))
        .expect(200);

      expect(res.body.household.name).toBeDefined();
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].role).toBe('owner');
      expect(res.body.members[0].userId.email).toBe(owner.email);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/households/me').expect(401);
    });
  });

  describe('invite → accept → shared access', () => {
    it('lets an invited user join and share the household data', async () => {
      const owner = await register(app, 'sharer');
      const invitee = await register(app, 'joiner');

      const token = await invite(owner.token, invitee.email);

      // Owner creates a subscription in the shared household.
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set(auth(owner.token))
        .send({
          name: 'Shared Netflix',
          cost: 15.99,
          billingCycle: 'monthly',
          nextBillingDate: '2025-07-01',
          category: 'Streaming',
        })
        .expect(201);

      // Before accepting, the invitee only sees their own (empty) household.
      const before = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set(auth(invitee.token))
        .expect(200);
      expect(before.body.data).toHaveLength(0);

      // Accept the invitation.
      const accepted = await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(invitee.token))
        .send({ token })
        .expect(201);
      expect(accepted.body.role).toBe('adult');

      // Now the invitee is in the owner's household and sees the shared data.
      const after = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set(auth(invitee.token))
        .expect(200);
      expect(after.body.data).toHaveLength(1);
      expect(after.body.data[0].name).toBe('Shared Netflix');

      // Both see the same two-member household.
      const ownerView = await request(app.getHttpServer())
        .get('/api/households/me')
        .set(auth(owner.token))
        .expect(200);
      expect(ownerView.body.members).toHaveLength(2);

      const inviteeView = await request(app.getHttpServer())
        .get('/api/households/me')
        .set(auth(invitee.token))
        .expect(200);
      expect(inviteeView.body.household.name).toBe(
        ownerView.body.household.name,
      );
    });
  });

  describe('owner-only guards', () => {
    let ownerToken: string;
    let memberToken: string;
    let memberId: string;

    beforeAll(async () => {
      const owner = await register(app, 'boss');
      const member = await register(app, 'staff');
      ownerToken = owner.token;
      memberToken = member.token;

      const token = await invite(ownerToken, member.email);
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(memberToken))
        .send({ token })
        .expect(201);

      const members = await request(app.getHttpServer())
        .get('/api/households/me/members')
        .set(auth(ownerToken))
        .expect(200);
      memberId = members.body.find((m: any) => m.role === 'adult')._id;
    });

    it('forbids a member from updating the household', async () => {
      await request(app.getHttpServer())
        .patch('/api/households/me')
        .set(auth(memberToken))
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('forbids a member from inviting', async () => {
      await request(app.getHttpServer())
        .post('/api/households/me/invitations')
        .set(auth(memberToken))
        .send({ email: 'someone@example.com' })
        .expect(403);
    });

    it('forbids a member from removing members', async () => {
      await request(app.getHttpServer())
        .delete(`/api/households/me/members/${memberId}`)
        .set(auth(memberToken))
        .expect(403);
    });

    it('lets the owner update the household name', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/households/me')
        .set(auth(ownerToken))
        .send({ name: 'Renamed Household' })
        .expect(200);
      expect(res.body.name).toBe('Renamed Household');
    });

    it('forbids removing the owner', async () => {
      const members = await request(app.getHttpServer())
        .get('/api/households/me/members')
        .set(auth(ownerToken))
        .expect(200);
      const ownerMemberId = members.body.find(
        (m: any) => m.role === 'owner',
      )._id;

      await request(app.getHttpServer())
        .delete(`/api/households/me/members/${ownerMemberId}`)
        .set(auth(ownerToken))
        .expect(403);
    });

    it('lets the owner remove a member', async () => {
      await request(app.getHttpServer())
        .delete(`/api/households/me/members/${memberId}`)
        .set(auth(ownerToken))
        .expect(204);

      const members = await request(app.getHttpServer())
        .get('/api/households/me/members')
        .set(auth(ownerToken))
        .expect(200);
      expect(members.body).toHaveLength(1);
    });
  });

  describe('invitation validation & isolation', () => {
    it('rejects an invalid token', async () => {
      const user = await register(app, 'tokentester');
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(user.token))
        .send({ token: 'not-a-real-token' })
        .expect(400);
    });

    it('forbids accepting an invitation addressed to a different email', async () => {
      const owner = await register(app, 'inviter2');
      const wrongUser = await register(app, 'wronguser');

      const token = await invite(owner.token, 'intended@example.com');

      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(wrongUser.token))
        .send({ token })
        .expect(403);
    });

    it('rejects inviting an existing active member of the household', async () => {
      const owner = await register(app, 'inviter3');
      const member = await register(app, 'member3');
      const token = await invite(owner.token, member.email);
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(member.token))
        .send({ token })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/households/me/invitations')
        .set(auth(owner.token))
        .send({ email: member.email })
        .expect(409);
    });

    it('cannot remove a member belonging to another household', async () => {
      const owner = await register(app, 'iso-owner');
      const outsider = await register(app, 'iso-outsider');

      // A member id from the owner's household.
      const members = await request(app.getHttpServer())
        .get('/api/households/me/members')
        .set(auth(owner.token))
        .expect(200);
      const ownerMemberId = members.body[0]._id;

      // The outsider (owner of their own household) cannot target it.
      await request(app.getHttpServer())
        .delete(`/api/households/me/members/${ownerMemberId}`)
        .set(auth(outsider.token))
        .expect(404);
    });

    it('rejects inviting a member as owner', async () => {
      const owner = await register(app, 'roleguard');
      await request(app.getHttpServer())
        .post('/api/households/me/invitations')
        .set(auth(owner.token))
        .send({ email: 'someone@example.com', role: 'owner' })
        .expect(400);
    });

    it('returns a shareable invite link without exposing the token hash', async () => {
      const owner = await register(app, 'linkowner');
      const res = await request(app.getHttpServer())
        .post('/api/households/me/invitations')
        .set(auth(owner.token))
        .send({ email: 'guest@example.com' })
        .expect(201);

      expect(res.body.inviteUrl).toContain('/household/accept?token=');
      expect(res.body.email).toBe('guest@example.com');
      expect(res.body.role).toBe('adult');
      expect(res.body.status).toBe('pending');
      expect(res.body).not.toHaveProperty('tokenHash');
    });

    it('supersedes a prior invitation: the old token stops working', async () => {
      const owner = await register(app, 'supersede');
      const invitee = await register(app, 'supersedee');

      const firstToken = await invite(owner.token, invitee.email);
      const secondToken = await invite(owner.token, invitee.email);
      expect(firstToken).not.toBe(secondToken);

      // The superseded (first) token is now revoked → rejected.
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(invitee.token))
        .send({ token: firstToken })
        .expect(400);

      // The newest token still works.
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(invitee.token))
        .send({ token: secondToken })
        .expect(201);
    });
  });

  describe('household lifecycle edges', () => {
    it('blocks an owner of a multi-member household from accepting elsewhere', async () => {
      const owner = await register(app, 'multiowner');
      const member = await register(app, 'multimember');

      // owner's household becomes multi-member.
      const joinToken = await invite(owner.token, member.email);
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(member.token))
        .send({ token: joinToken })
        .expect(201);

      // A third party invites the owner away.
      const outsider = await register(app, 'multioutsider');
      const lureToken = await invite(outsider.token, owner.email);

      // The owner cannot abandon a household that still has other members.
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(owner.token))
        .send({ token: lureToken })
        .expect(409);
    });

    it('re-provisions a personal household for a removed member', async () => {
      const owner = await register(app, 'evicter');
      const member = await register(app, 'evictee');

      const joinToken = await invite(owner.token, member.email);
      await request(app.getHttpServer())
        .post('/api/households/invitations/accept')
        .set(auth(member.token))
        .send({ token: joinToken })
        .expect(201);

      const members = await request(app.getHttpServer())
        .get('/api/households/me/members')
        .set(auth(owner.token))
        .expect(200);
      const memberId = members.body.find((m: any) => m.role === 'adult')._id;

      await request(app.getHttpServer())
        .delete(`/api/households/me/members/${memberId}`)
        .set(auth(owner.token))
        .expect(204);

      // The removed member is not locked out: they land in a fresh personal
      // household where they are the owner.
      const view = await request(app.getHttpServer())
        .get('/api/households/me')
        .set(auth(member.token))
        .expect(200);
      expect(view.body.members).toHaveLength(1);
      expect(view.body.members[0].role).toBe('owner');
    });
  });
});
