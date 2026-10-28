import "dotenv/config";

/** The test database URL, refusing anything whose database name lacks "_test". */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": the test database name must end in _test.`);
  }
  return url;
}
