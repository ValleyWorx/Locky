const hid = require('node-hid');
console.log(hid.devices());
const device = new hid.HID(1133, 49948);
const log = data => console.log(`data: ${JSON.stringify(data)}`);
function toNumber(code) {
  return (code - 88) % 10;
}
function onData(buffer) {
  const { data } = buffer.toJSON();
  const [ctrl, , code] = data;
  if (!ctrl && !code) return;
  const num = toNumber(code);
  console.log(ctrl, code, num);
  if (ctrl === 1 && code === 6) {
    device.close();
    process.exit();
  }
}
device.on('data', onData);
