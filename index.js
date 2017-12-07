require('dotenv').config();
const hid = require('node-hid');
const path = require('path');
const Datastore = require('nedb');
const admin = require('firebase-admin');
const R = require('ramda');
const util = require('util');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const RateLimiter = require('limiter').RateLimiter;
const serviceAccount = require('./key.json');
const limiter = new RateLimiter(20, 'minute', true);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const localDb = new Datastore({
  filename: path.join(__dirname, 'localdb.db'),
  autoload: true
});
localDb.find = util.promisify(localDb.find);
localDb.insert = util.promisify(localDb.insert);
localDb.update = util.promisify(localDb.update);

const userCollection = db.collection('user');
userCollection.onSnapshot(async snapShot => {
  const docs = R.map(doc => {
    const { id } = doc;
    return R.merge(doc.data(), { id });
  })(snapShot.docs);
  R.forEach(async doc => {
    const { id } = doc;
    const localDoc = await localDb.find({ id });
    console.log(localDoc.length);
    if (localDoc.length === 0) {
      await localDb.insert(doc);
    } else {
      await localDb.update({ id }, doc);
    }
    console.log({ localDoc });
  })(docs);
  console.log(docs);
  // console.log(doc.docs[0].data());
});

// const device = new hid.HID(1133, 49948);
const device = new hid.HID(1226, 58);
function toNumber(code) {
  // TODO: handle enter key, period key gives zero
  switch (code) {
    case 99:
      return '.';
    case 88:
      return '\n';
    default:
      return (code - 88) % 10;
  }
}
let lastHash;
let _userCode = '';
function onData(buffer) {
  const { data } = buffer.toJSON();
  const hash = crypto
    .createHash('md5')
    .update(JSON.stringify(data))
    .digest('hex');
  if (hash === lastHash) return;
  lastHash = hash;
  const [ctrl, , code] = data;
  if (!ctrl && !code) return;
  const num = toNumber(code);
  if (ctrl === 1 && code === 6) {
    device.close();
    process.exit();
  }
  if (num === '\n') {
    limiter.removeTokens(1, () => {
      verifyUserCode(_userCode);
    });
    _userCode = '';
    return;
  }
  _userCode += num;
  console.log(hash);
  console.log({ ctrl, code, num });
}
device.on('data', onData);

async function verifyUserCode(userCode) {
  const tokens = limiter.getTokensRemaining();
  console.log({ tokens });
  if (tokens < 1) return;
  const [id, code] = userCode.split('.');
  console.log({ id, code });

  const [user] = await localDb.find({ id });
  if (!user) return;
  const { hashedCode } = user;
  const isValid = await bcrypt.compare(code, hashedCode);

  console.log({ user, isValid });
}
// (async () => {
//   const hash = await bcrypt.hash('1235', 10);
//   console.log(hash);
// })();
