'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, JPEG, PDF_PROOF } = require('./helpers');
const { priceStatus, sourceFromUrl } = require('../src/routes/houses');
const { addressKey } = require('../src/lib/address');

const RATINGS = { heat: 4, mould: 5, pests: 4, landlord_response: 3, deposit_returned: 4, noise: 3, water_pressure: 4, outlets: 2, appliances: 4 };

describe('sign-in and profiles', () => {
  let ctx;
  before(async () => { ctx = await createTestContext(); });
  after(() => ctx.close());

  test('any email can sign up', async () => {
    for (const email of ['a@gmail.com', 'b@mcmaster.ca', 'c@outlook.com']) {
      const user = await ctx.login(email);
      assert.ok(user.token, email);
    }
  });

  test('rejects malformed emails and wrong codes', async () => {
    await request(ctx.app).post('/api/auth/otp/request').send({ email: 'nope' }).expect(400);
    await request(ctx.app).post('/api/auth/otp/request').send({ email: 'x@gmail.com' }).expect(200);
    await request(ctx.app).post('/api/auth/otp/verify').send({ email: 'x@gmail.com', code: '000000' }).expect(400);
  });

  test('profile holds several roles and sliders', async () => {
    const user = await ctx.login('roles@gmail.com');
    const res = await ctx.as(user).patch('/api/me/profile')
      .send({ displayName: 'Ali', roles: ['former', 'looking'], budget: 750, moveIn: '2027-09', sliders: { commute: 5, social: 0 } })
      .expect(200);
    assert.deepEqual(res.body.profile.roles, ['former', 'looking']);
    assert.equal(res.body.profile.sliders.commute, 5);
    assert.equal(res.body.profile.sliders.social, 0);
    assert.equal(res.body.profile.sliders.food, 3);
    await ctx.as(user).patch('/api/me/profile').send({ roles: ['wizard'] }).expect(400);
  });

  test('cookie writes need the CSRF header', async () => {
    await request(ctx.app).post('/api/auth/otp/request').send({ email: 'c2@gmail.com' }).expect(200);
    const res = await request(ctx.app).post('/api/auth/otp/verify').send({ email: 'c2@gmail.com', code: ctx.lastCodeFor('c2@gmail.com') });
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    await request(ctx.app).patch('/api/me/profile').set('cookie', cookie).send({ displayName: 'X' }).expect(403);
    await request(ctx.app).patch('/api/me/profile').set('cookie', cookie).set('x-requested-with', 'fetch').send({ displayName: 'X' }).expect(200);
  });
});

describe('listings, opinions and reviews', () => {
  let ctx;
  let student;
  let landlord;
  let admin;
  let houseId;
  before(async () => {
    ctx = await createTestContext({ samples: true });
    student = await ctx.signup('student@gmail.com', { roles: ['former'] });
    landlord = await ctx.signup('owner@gmail.com', { roles: ['landlord'] });
    admin = await ctx.signup('admin@example.com');
  });
  after(() => ctx.close());

  test('sample houses are seeded and labelled', async () => {
    const res = await request(ctx.app).get('/api/houses').expect(200);
    assert.equal(res.body.houses.length, 8);
    assert.ok(res.body.houses.every((h) => h.isSample));
  });

  test('anyone signed in can paste a link; photos stay on the original site', async () => {
    const res = await ctx.as(student).post('/api/houses').send({
      address: '12 Emerson Street, Hamilton, ON', neighbourhood: 'Westdale', bedrooms: 5, rentPerRoom: 725,
      url: 'https://www.kijiji.ca/v-apartments/hamilton/123',
    }).expect(201);
    houseId = res.body.houseId;
    assert.deepEqual(ctx.rescored, [houseId]);
    const house = await request(ctx.app).get(`/api/houses/${houseId}`).expect(200);
    assert.equal(house.body.listings[0].sourceName, 'Kijiji');
    assert.equal(house.body.listings[0].price.status, 'current');
  });

  test('the same address with different spelling is the same house', async () => {
    const res = await ctx.as(student).post('/api/houses').send({
      address: '12 emerson st', neighbourhood: 'Westdale', bedrooms: 5, rentPerRoom: 700, url: 'https://rentals.ca/x',
    }).expect(201);
    assert.equal(res.body.houseId, houseId);
  });

  test('only landlords post their own listing, with photos', async () => {
    await ctx.as(student).post('/api/houses').send({ address: '5 Leland St', neighbourhood: 'Ainslie Wood', bedrooms: 4, rentPerRoom: 640 }).expect(403);
    const photo = await ctx.as(landlord).post('/api/photos').set('content-type', 'image/jpeg').send(JPEG).expect(201);
    await ctx.as(landlord).post('/api/houses').send({
      address: '12 Emerson St', neighbourhood: 'Westdale', bedrooms: 5, rentPerRoom: 725, photos: [photo.body.url],
      proof: PDF_PROOF,
    }).expect(201);
    await request(ctx.app).get(photo.body.url).expect(200).expect('content-type', 'image/jpeg');
  });

  test('a street with no house number is refused', async () => {
    await ctx.as(student).post('/api/houses').send({ address: 'Emerson St', neighbourhood: 'Westdale', bedrooms: 5, rentPerRoom: 700, url: 'https://kijiji.ca/a' }).expect(400);
  });

  test('opinions are open to anyone, once per house, and landlords can reply', async () => {
    const op = await ctx.as(student).post(`/api/houses/${houseId}/opinions`).send({ role: 'former', stars: 4, body: 'Warm in winter.' }).expect(201);
    await ctx.as(student).post(`/api/houses/${houseId}/opinions`).send({ role: 'former', stars: 4, body: 'Again' }).expect(409);
    await ctx.as(student).post(`/api/opinions/${op.body.id}/reply`).send({ body: 'Thanks' }).expect(403);
    await ctx.as(landlord).post(`/api/opinions/${op.body.id}/reply`).send({ body: 'Thanks!' }).expect(200);
    const house = await request(ctx.app).get(`/api/houses/${houseId}`).expect(200);
    assert.equal(house.body.opinions[0].reply, 'Thanks!');
    assert.equal(house.body.opinions[0].verified, false);
  });

  test('reviews need a lease and only count once a person approves it', async () => {
    await ctx.as(student).post(`/api/houses/${houseId}/reviews`).send({ ratings: RATINGS, livedUntil: '2026-04' }).expect(400);
    await ctx.as(student).post(`/api/houses/${houseId}/reviews`)
      .send({ ratings: RATINGS, livedUntil: '2026-04', utilitiesPerMonth: 90, proof: PDF_PROOF }).expect(201);
    let house = await request(ctx.app).get(`/api/houses/${houseId}`).expect(200);
    assert.equal(house.body.reviews.count, 0);

    await ctx.as(student).get('/api/admin/proofs').expect(403);
    const queue = await ctx.as(admin).get('/api/admin/proofs').expect(200);
    const lease = queue.body.find((p) => p.kind === 'lease');
    await ctx.as(admin).get(`/api/admin/proofs/${lease.id}/file`).expect(200).expect('content-type', 'application/pdf');
    ctx.rescored.length = 0;
    await ctx.as(admin).post(`/api/admin/proofs/${lease.id}`).send({ decision: 'approve' }).expect(200);
    assert.deepEqual(ctx.rescored, [houseId]);
    await ctx.as(admin).get(`/api/admin/proofs/${lease.id}/file`).expect(404);
    const { rows } = await ctx.db.query('SELECT data FROM proofs WHERE id = $1', [lease.id]);
    assert.equal(rows[0].data, null, 'the lease file is deleted once checked');

    house = await request(ctx.app).get(`/api/houses/${houseId}`).expect(200);
    assert.equal(house.body.reviews.count, 1);
    assert.equal(house.body.reviews.items.find((i) => i.id === 'mould').average, 5);
    assert.equal(house.body.opinions[0].verified, true, 'the reviewer’s opinion now shows as a verified tenant');
  });

  test('ownership proof marks the landlord listing as verified', async () => {
    const queue = await ctx.as(admin).get('/api/admin/proofs').expect(200);
    const own = queue.body.find((p) => p.kind === 'ownership');
    await ctx.as(admin).post(`/api/admin/proofs/${own.id}`).send({ decision: 'approve' }).expect(200);
    const house = await request(ctx.app).get(`/api/houses/${houseId}`).expect(200);
    assert.ok(house.body.listings.some((l) => l.source === 'landlord' && l.ownerVerified));
  });

  test('three reports hide an opinion', async () => {
    const other = await ctx.signup('n@gmail.com', { roles: ['neighbour'] });
    const op = await ctx.as(other).post(`/api/houses/${houseId}/opinions`).send({ role: 'neighbour', stars: 1, body: 'rude stuff' }).expect(201);
    for (const email of ['r1@gmail.com', 'r2@gmail.com', 'r3@gmail.com']) {
      const u = await ctx.login(email);
      await ctx.as(u).post(`/api/opinions/${op.body.id}/report`).send({ reason: 'personal attack' }).expect(200);
    }
    const house = await request(ctx.app).get(`/api/houses/${houseId}`).expect(200);
    assert.ok(!house.body.opinions.some((o) => o.id === op.body.id));
  });
});

describe('ranking', () => {
  let ctx;
  before(async () => { ctx = await createTestContext({ samples: true }); });
  after(() => ctx.close());

  async function setScores(address, values, confidence) {
    const { rows } = await ctx.db.query('SELECT id FROM houses WHERE address = $1', [address]);
    for (const [name, value] of Object.entries(values)) {
      await ctx.db.query('INSERT INTO scores (house_id, name, value, confidence) VALUES ($1, $2, $3, $4)', [rows[0].id, name, value, confidence]);
    }
  }

  test('sliders change the order and low confidence is pulled toward the median', async () => {
    await setScores('Emerson St (sample)', { commute: 9, social: 2 }, 0.9);
    await setScores('Sterling St (sample)', { commute: 3, social: 9 }, 0.9);
    await setScores('Leland St (sample)', { commute: 10, social: 10 }, 0.1);
    await setScores('Dalewood Ave (sample)', { commute: 6, social: 6 }, 0.9);
    const commuteFirst = await request(ctx.app).get('/api/houses?commute=5&social=1&food=0&inside=0&value=0').expect(200);
    const socialFirst = await request(ctx.app).get('/api/houses?commute=1&social=5&food=0&inside=0&value=0').expect(200);
    const westdale = (r) => r.body.houses.filter((h) => h.neighbourhood === 'Westdale').map((h) => h.address);
    assert.deepEqual(westdale(commuteFirst), ['Emerson St (sample)', 'Sterling St (sample)']);
    assert.deepEqual(westdale(socialFirst), ['Sterling St (sample)', 'Emerson St (sample)']);
    const leland = socialFirst.body.houses.find((h) => h.address === 'Leland St (sample)');
    assert.equal(leland.overall, 10);
    assert.ok(leland.rankKey < 10, 'a low-confidence 10 is not ranked as a 10');
  });

  test('price freshness and link sources', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    assert.equal(priceStatus('2026-10-20', now), 'current');
    assert.equal(priceStatus('2026-10-12', now), 'stale');
    assert.equal(priceStatus('2026-10-01', now), 'may_be_rented');
    assert.equal(priceStatus('2026-09-01', now), 'history_only');
    assert.equal(sourceFromUrl('https://www.facebook.com/marketplace/item/1').name, 'Facebook Marketplace');
    assert.throws(() => sourceFromUrl('javascript:alert(1)'));
  });

  test('address keys match the Python engine', () => {
    assert.equal(addressKey('12 Emerson Street, Hamilton, ON L8S 1A1'), '12 emerson st');
  });
});
