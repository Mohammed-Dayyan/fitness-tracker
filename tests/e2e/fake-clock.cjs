// Test-only preload (NODE_OPTIONS="--require ..."): shifts the server's clock
// so "now" starts at FAKE_START. Used to test what happens at local midnight.
const RealDate = Date;
const offset = new RealDate(process.env.FAKE_START).getTime() - RealDate.now();
class FakeDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [RealDate.now() + offset]));
  }
  static now() {
    return RealDate.now() + offset;
  }
}
globalThis.Date = FakeDate;
