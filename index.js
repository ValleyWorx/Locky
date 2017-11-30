require('dotenv').config();
const path = require('path');
const Datastore = require('nedb');
const admin = require('firebase-admin');
const R = require('ramda');
const util = require('util');

const serviceAccount = require('./key.json');

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
