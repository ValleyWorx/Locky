const hid = require('node-hid');
console.log(hid.devices());
// const device = new hid.HID(1133, 49948);
const device = new hid.HID(1226, 58);
function toNumber(code) {
  // TODO: handle enter key, period key gives zero
  return (code - 88) % 10;
}
function onData(buffer) {
  const { data } = buffer.toJSON();
  const [ctrl, , code] = data;
  if (!ctrl && !code) return;
  const num = toNumber(code);
  if (ctrl === 1 && code === 6) {
    device.close();
    process.exit();
  }
  console.log({ ctrl, code, num });
}
device.on('data', onData);
