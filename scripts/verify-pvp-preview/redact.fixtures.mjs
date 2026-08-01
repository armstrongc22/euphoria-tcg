// ============================================================================
// Regression fixtures: fake infrastructure values that must NEVER survive into
// a generated report or artifact.
// ============================================================================
// Every value here is invented (RFC 5737 / RFC 3849 documentation addresses,
// nonsense project refs, a signature-less JWT). They exist so the redaction
// tests fail loudly if a rule stops matching the shape that actually leaked.

/** The literal values that must not appear in any report. */
export const FAKE = {
  poolerHost: "aws-0-us-fake-1.pooler.supabase.com",
  directHost: "db.fakepreviewrefabcxyz.supabase.co",
  apiHost: "fakepreviewrefabcxyz.supabase.co",
  ipv4: "198.51.100.42",
  ipv6Full: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  ipv6Compressed: "2001:db8::1",
  projectRef: "fakepreviewrefabcxyz",
  prodProjectRef: "fakeprodrefabcdwxyz1",
  dbUser: "postgres.fakepreviewrefabcxyz",
  connectionUri:
    "postgresql://postgres.fakepreviewrefabcxyz:s3cr3tFakePw@aws-0-us-fake-1.pooler.supabase.com:5432/postgres?sslmode=require",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.FaKeSiGnAtUrEvAlUe",
  secretKey: "sb_secret_FAKEfakeFAKE1234567890",
  publishableKey: "sb_publishable_FAKEfake1234567890",
};

/** All fake values as a flat list — the assertion set for "nothing survives". */
export const FAKE_VALUES = Object.values(FAKE);

/** Realistic psql stderr blobs, each tagged with its expected category. */
export const DB_ERROR_FIXTURES = [
  {
    name: "pooler connection refused (leaks pooler host + IPv4)",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: connection to server at "${FAKE.poolerHost}" (${FAKE.ipv4}), port 5432 failed: Connection refused
\tIs the server running on that host and accepting TCP/IP connections?`,
  },
  {
    name: "direct host unreachable (leaks db.<ref> host + full IPv6)",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: connection to server at "${FAKE.directHost}" (${FAKE.ipv6Full}), port 5432 failed: Network is unreachable`,
  },
  {
    name: "compressed IPv6 timeout",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: connection to server at "${FAKE.directHost}" (${FAKE.ipv6Compressed}), port 5432 failed: timeout expired`,
  },
  {
    name: "DNS failure (leaks direct host + project ref)",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: could not translate host name "${FAKE.directHost}" to address: Name or service not known`,
  },
  {
    name: "password auth failure (leaks Supavisor tenant username)",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: connection to server at "${FAKE.poolerHost}" (${FAKE.ipv4}), port 6543 failed: FATAL:  password authentication failed for user "${FAKE.dbUser}"`,
  },
  {
    name: "no pg_hba entry (leaks username + IP)",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: connection to server at "${FAKE.poolerHost}" (${FAKE.ipv4}), port 5432 failed: FATAL:  no pg_hba.conf entry for host "${FAKE.ipv4}", user "${FAKE.dbUser}", database "postgres", no encryption`,
  },
  {
    name: "missing function",
    category: "MISSING_FUNCTION",
    stderr: `ERROR:  function public.join_pvp_room(text) does not exist
LINE 1: select public.join_pvp_room('abc');
               ^
HINT:  No function matches the given name and argument types.`,
  },
  {
    name: "permission denied",
    category: "PERMISSION_DENIED",
    stderr: "ERROR:  permission denied for function join_pvp_room",
  },
  {
    name: "migration fail-loud assertion",
    category: "MIGRATION_ASSERTION_RAISED",
    stderr: `ERROR:  public.join_pvp_room is missing: expected exactly one overload
CONTEXT:  PL/pgSQL function inline_code_block line 12 at RAISE`,
  },
  {
    name: "missing relation",
    category: "MISSING_RELATION",
    stderr: 'ERROR:  relation "public.pvp_rooms" does not exist',
  },
  {
    name: "kitchen sink: URI, JWT, keys, auth header, host, IPs, ref, username",
    category: "DATABASE_CONNECTIVITY_FAILED",
    stderr: `psql: error: connection to server at "${FAKE.poolerHost}" (${FAKE.ipv4}), port 5432 failed
  tried: ${FAKE.connectionUri}
  fallback: ${FAKE.directHost} [${FAKE.ipv6Full}] / ${FAKE.ipv6Compressed}
  api: https://${FAKE.apiHost}/rest/v1/  authorization: Bearer ${FAKE.jwt}
  apikey: ${FAKE.publishableKey}  service: ${FAKE.secretKey}
  user=${FAKE.dbUser} ref=${FAKE.projectRef} prod_ref=${FAKE.prodProjectRef}`,
  },
];
