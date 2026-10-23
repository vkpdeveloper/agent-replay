import { describe, expect, test } from "bun:test";
import { MASK, redact } from "./redact.ts";

// Fake credentials are assembled at runtime so secret scanners don't flag this file.
const fake = (...parts: string[]) => parts.join("");

describe("redact masks", () => {
  const cases: [string, string, string][] = [
    ["anthropic key", fake("ANTHROPIC_API_KEY=sk-", "ant-api03-", "AbCdEf0123456789AbCdEf0123456789"), "sk-ant-api03-"],
    ["openai key", fake("key is sk-", "proj-", "AbCdEf0123456789AbCdEf0123"), "sk-proj-"],
    ["github token", fake("gh auth token -> gh", "o_", "16C7e42F292c6912E7710c838347Ae178B4a"), "gho_"],
    ["aws access key", "aws_access_key_id = AKIAIOSFODNN7EXAMPLE", "aws_access_key_id = "],
    ["stripe key", fake("sk_", "live_", "51HxAbCdEfGhIjKlMn"), "sk_live_"],
    ["slack token", fake("xo", "xb-", "1234567890-abcdefghij"), "xoxb-"],
    ["jwt", fake("token ey", "JhbGciOiJIUzI1NiJ9.ey", "JzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"), ""],
    ["bearer header", 'curl -H "Authorization: Bearer abc123def456ghi789"', "Authorization: Bearer "],
    ["url credentials", fake("DATABASE_URL=postgres://admin:", "hunter2pass", "@db.internal:5432/app"), "postgres://admin:"],
    ["env password", "DB_PASSWORD=Sup3rS3cret!", "DB_PASSWORD="],
    ["json password", '{"password": "correct horse"}', '"password": "'],
    ["yaml secret", "client_secret: 9f8e7d6c5b4a", "client_secret: "],
    ["cli flag", "mysql --password=Tr0ub4dor&3", "--password="],
    ["unprefixed token", fake("CLOUDFLARE_API_TOKEN=", "Xk9fQ2mZ7vL0pR4t", "W8yB3nC6hJ1sD5gA"), "CLOUDFLARE_API_TOKEN="],
    ["bare random token", fake("use this: ", "q7Rk2LmZx9VbN4tYp0Wc", "J6sHf3GdA8eU1KoT"), ""],
  ];

  for (const [name, input, kept] of cases) {
    test(name, () => {
      const out = redact(input);
      expect(out).toContain(MASK);
      if (kept) expect(out).toContain(kept);
    });
  }

  test("private key block", () => {
    const key = fake("-----BEGIN OPENSSH ", "PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH ", "PRIVATE KEY-----");
    const out = redact(key);
    expect(out).not.toContain("b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ");
    expect(out).toContain(MASK);
  });

  test("replaces the home directory", () => {
    expect(redact("/Users/alex/project/src", "/Users/alex")).toBe("~/project/src");
  });
});

describe("redact leaves alone", () => {
  const safe = [
    "git checkout 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f",
    "id: 01a107ea-8ec9-7243-86de-a473ad9c5f69",
    "const token = await getToken();",
    "apiKey: process.env.OPENAI_API_KEY",
    "password: user.password",
    '"input_tokens": 131425',
    "max_output_tokens: 2500",
    "API_KEY=${API_KEY}",
    "TOKEN=<your-token>",
    'description: "the token used for uploads to the bucket"',
    "export function renderMediaOnWebWithProgressCallback() {}",
    "src/components/very-long-component-name-for-the-dashboard.tsx",
    '{"anthropic-ratelimit-input-tokens-limit": "4000000"}',
    '{"secret_file_modes": {".zsh_secrets": "0600"}}',
    "usage: ls [-@ABCFGHILOPRSTUWXabcdefghiklmnopqrstuvwxy1%,]",
  ];
  for (const input of safe) {
    test(input, () => expect(redact(input)).toBe(input));
  }
});
