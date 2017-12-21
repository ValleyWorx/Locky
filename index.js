const R = require('ramda');
const fireStore = require('firebase-admin');
const hid = require('node-hid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jsonfile = require('jsonfile');
const debounce = require('lodash.debounce');
const key = require('./key.json');
const gpio = require('rpi-gpio');
const utility = require('util');

const PIN = 2;
const DOOR_TIMEOUT = 5000;

gpio.setup = utility.promisify(gpio.setup);
gpio.write = utility.promisify(gpio.write);

function cmd(fn, args = []) {
  return { fn, args };
}

const USERS = './users.json';

const init = [
  {
    userCode: '',
    users: {}
  },
  cmd(load)
];

const MSGS = {
  USER_INPUT: 'USER_INPUT',
  USER_UPDATE: 'USER_UPDATE',
  USERS_REPLACE: 'USERS_REPLACE',
  USER_INPUT_REPLACE: 'USER_INPUT_REPLACE'
};

function userInputMsg(input) {
  return {
    type: MSGS.USER_INPUT,
    input
  };
}

function userUpdateMsg(user) {
  return {
    type: MSGS.USER_UPDATE,
    user
  };
}
function usersReplaceMsg(users) {
  return {
    type: MSGS.USERS_REPLACE,
    users
  };
}

function userInputReplaceMsg(input) {
  return {
    type: MSGS.USER_INPUT_REPLACE,
    input
  };
}

function update(msg, model) {
  console.log(JSON.stringify({ msg, model }, null, 2));
  switch (msg.type) {
    case MSGS.USER_INPUT: {
      return userInputUpdate(msg, model);
    }
    case MSGS.USER_INPUT_REPLACE: {
      return R.merge(model, { userCode: '' });
    }
    case MSGS.USER_UPDATE: {
      const { user: { id, ...user } } = msg;
      const users = R.merge(model.users, { [id]: user });
      const saveCmd = cmd(debounce(save, 5000), [users]);
      return [R.merge(model, { users }), saveCmd];
    }
    case MSGS.USERS_REPLACE: {
      const { users } = msg;
      return R.merge(model, { users });
    }
  }
}

function userInputUpdate(msg, model) {
  const { input } = msg;
  const { users, userCode } = model;
  if (input === '\n') {
    const isVerified = verifyUserCode(users, userCode);
    const updatedModel = R.merge(model, { userCode: '' });
    const unlockCmd = isVerified ? cmd(unlock) : null;
    return [updatedModel, unlockCmd];
  }
  const updatedUserCode = model.userCode + input;
  return [R.merge(model, { userCode: updatedUserCode })];
}

function verifyUserCode(users, userCode) {
  const [id, code] = userCode.split('.');
  const { hashedCode } = R.propOr({}, id, users);
  if (!hashedCode) return false;
  return bcrypt.compareSync(code, hashedCode);
}

function codeToInput(code) {
  switch (code) {
    case 99:
      return '.';
    case 88:
      return '\n';
    default:
      return (code - 88) % 10;
  }
}

// side-effects below

function app(init, update) {
  const [initModel, initCmd] = init;
  let model = initModel;
  let cmd;
  exec(initCmd);
  function exec(cmd) {
    console.log({ cmd });
    const { fn = () => {}, args = [] } = cmd || {};
    const updatedArgs = R.prepend(send, args);
    R.apply(fn, updatedArgs);
  }
  function send(msg) {
    const res = update(msg, model);
    if (R.type(res) === 'Array') {
      model = res[0];
      cmd = res[1];
    } else {
      model = res;
      cmd = null;
    }
    exec(cmd);
  }
}

const onSnapshot = R.curry((send, { docs }) => {
  function sendUserUpdateMsg(doc) {
    const user = R.merge(doc.data(), { id: doc.id });
    const msg = userUpdateMsg(user);
    send(msg);
  }
  R.forEach(sendUserUpdateMsg, docs);
});
async function load(send) {
  await gpio.setup(PIN, gpio.DIR_OUT);
  try {
    const users = jsonfile.readFileSync(USERS);
    send(usersReplaceMsg(users));
  } catch (err) {
    console.log(err);
  }
  keypadListener(send);
  dbListener(send);
}

function dbListener(send) {
  fireStore.initializeApp({
    credential: fireStore.credential.cert(key)
  });
  const db = fireStore.firestore();
  const userCollection = db.collection('user');
  userCollection.onSnapshot(onSnapshot(send));
}

function keypadListener(send) {
  // TODO: figure out how to dynamicly figure out vid, pid below
  // console.log(hid.devices());
  const devices = hid.devices();
  const deviceConfig = R.find(R.propEq('manufacturer', 'SIGMACHIP'), devices);
  const { vendorId, productId } = deviceConfig;
  try {
    const device = new hid.HID(vendorId, productId);
    device.on('data', onKeypadData(send, device));
    process.stdin.resume();//so the program will not close instantly

    function exitHandler(options, err) {
      if (options.cleanup) {
        device.close();
        console.log('clean')
      };
      if (err) console.log(err.stack);
      if (options.exit) {
        process.exit();
      }
    }

    //do something when app is closing
    process.on('exit', exitHandler.bind(null,{cleanup:true}));

    //catches ctrl+c event
    process.on('SIGINT', exitHandler.bind(null, {exit:true}));

    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
    process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

    //catches uncaught exceptions
    process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
    
  } catch (err) {
    console.log(err);
  }
}

function onKeypadData(send, device) {
  let lastHash;
  let limit = 20;
  setInterval(() => {
    limit = 20;
  }, 60000);
  return function(buffer) {
    const { data } = buffer.toJSON();
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(data))
      .digest('hex');
    if (hash === lastHash) return;
    lastHash = hash;
    const [ctrl, , code] = data;
    if (!ctrl && !code) return;
    const input = codeToInput(code);
    if (input === '\n' && --limit < 0) {
      return send(userInputReplaceMsg(''));
    }
    if (ctrl === 1 && code === 6) {
      device.close();
      process.exit();
    }
    send(userInputMsg(input));
  };
}

function save(send, users) {
  jsonfile.writeFileSync(USERS, users);
}

async function unlock(send) {
  // unlock door
  console.log('unlock called...');
  await gpio.write(PIN, true);
  setTimeout(() => {
    gpio.write(PIN, false);
  }, DOOR_TIMEOUT);
}

app(init, update);
