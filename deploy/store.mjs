import { MongoClient } from 'mongodb';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 32)).toString('hex')}`;
}
export async function passwordMatches(password, encoded) {
  const [salt, hash] = encoded.split(':');
  const actual = await derive(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function connectStore(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('prospector_portfolio');
  await Promise.all([
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('favorites').createIndex({ userId: 1, id: 1 }, { unique: true }),
    db.collection('history').createIndex({ userId: 1, createdAt: -1 }),
  ]);
  return {
    close: () => client.close(),
    async register(username, hash) {
      const r = await db.collection('users').insertOne({ username, hash });
      return { id: r.insertedId.toString(), username };
    },
    async lookup(username) {
      const u = await db.collection('users').findOne({ username });
      return u ? { id: u._id.toString(), username: u.username, hash: u.hash } : null;
    },
    async createSession(user, token) {
      await db.collection('sessions').insertOne({ tokenHash: tokenHash(token), user,
        expiresAt: new Date(Date.now() + 86400000) });
    },
    async session(token) {
      const s = await db.collection('sessions').findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
      return s?.user || null;
    },
    async endSession(token) { await db.collection('sessions').deleteOne({ tokenHash: tokenHash(token) }); },
    async save(userId, item) {
      await db.collection('favorites').updateOne({ userId, id: item.id }, { $set: { item } }, { upsert: true });
    },
    async favorites(userId) { return (await db.collection('favorites').find({ userId }).limit(100).toArray()).map(x => x.item); },
    async remove(userId, id) { await db.collection('favorites').deleteOne({ userId, id }); },
    async remember(userId, query) { await db.collection('history').insertOne({ userId, query, createdAt: new Date() }); },
    async history(userId) { return (await db.collection('history').find({ userId }).sort({ createdAt: -1 }).limit(20).toArray()).map(({ query, createdAt }) => ({ query, createdAt })); },
  };
}
