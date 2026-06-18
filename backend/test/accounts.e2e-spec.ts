import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Accounts (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Each registered user is provisioned their own personal household, so
    // usera and userb start in separate households — the basis for the
    // cross-household isolation assertions below.
    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'usera', password: 'Password123' });
    tokenA = resA.body.access_token;

    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'userb', password: 'Password123' });
    tokenB = resB.body.access_token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('CRUD lifecycle', () => {
    let checkingId: string;
    let savingsId: string;

    it('creates an account with an integer opening balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Everyday Checking',
          type: 'checking',
          balanceCents: 125000,
        })
        .expect(201);

      expect(res.body._id).toBeDefined();
      expect(res.body.name).toBe('Everyday Checking');
      expect(res.body.type).toBe('checking');
      expect(res.body.balanceCents).toBe(125000);
      expect(res.body.isArchived).toBe(false);
      checkingId = res.body._id;
    });

    it('defaults the opening balance to 0 cents', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Rainy Day', type: 'savings' })
        .expect(201);

      expect(res.body.balanceCents).toBe(0);
      savingsId = res.body._id;
    });

    it('lists the household accounts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('gets a single account', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/accounts/${checkingId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body._id).toBe(checkingId);
    });

    it('updates an account', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/accounts/${checkingId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Main Checking' })
        .expect(200);

      expect(res.body.name).toBe('Main Checking');
    });

    it('archives an account on DELETE (204) without removing it', async () => {
      await request(app.getHttpServer())
        .delete(`/api/accounts/${checkingId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      // Still fetchable (soft delete), flagged archived.
      const res = await request(app.getHttpServer())
        .get(`/api/accounts/${checkingId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.isArchived).toBe(true);
    });

    it('excludes archived accounts from the default list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]._id).toBe(savingsId);
    });

    it('includes archived accounts when includeArchived=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounts?includeArchived=true')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('restores an archived account via PATCH isArchived=false', async () => {
      await request(app.getHttpServer())
        .patch(`/api/accounts/${checkingId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body).toHaveLength(2);
    });

    it('archives idempotently on a repeated DELETE', async () => {
      await request(app.getHttpServer())
        .delete(`/api/accounts/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/api/accounts/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get(`/api/accounts/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.isArchived).toBe(true);

      // Restore so later count-based assertions stay stable.
      await request(app.getHttpServer())
        .patch(`/api/accounts/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: false })
        .expect(200);
    });
  });

  describe('validation', () => {
    it('rejects a missing name', async () => {
      await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'checking' })
        .expect(400);
    });

    it('rejects an invalid account type', async () => {
      await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Bad', type: 'crypto' })
        .expect(400);
    });

    it('rejects a non-integer balanceCents', async () => {
      await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Floaty', type: 'checking', balanceCents: 1.5 })
        .expect(400);
    });

    it('rejects unknown fields (whitelist)', async () => {
      await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Sneaky', type: 'checking', hacker: true })
        .expect(400);
    });

    it('rejects a non-integer balanceCents on PATCH', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Patchy', type: 'checking' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/accounts/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ balanceCents: 1.5 })
        .expect(400);
    });
  });

  describe('cross-household isolation', () => {
    let accountId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Private', type: 'checking' })
        .expect(201);
      accountId = res.body._id;
    });

    it("does not surface another household's account in the list", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.every((a: { _id: string }) => a._id !== accountId)).toBe(
        true,
      );
    });

    it("returns 404 when reading another household's account", async () => {
      await request(app.getHttpServer())
        .get(`/api/accounts/${accountId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it("returns 404 when updating another household's account", async () => {
      await request(app.getHttpServer())
        .patch(`/api/accounts/${accountId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it("returns 404 when archiving another household's account", async () => {
      await request(app.getHttpServer())
        .delete(`/api/accounts/${accountId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe('not found & auth', () => {
    it('returns 404 for an unknown account id', async () => {
      await request(app.getHttpServer())
        .get('/api/accounts/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('returns 400 (not 500) for a malformed account id', async () => {
      await request(app.getHttpServer())
        .get('/api/accounts/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/accounts').expect(401);
    });
  });
});
