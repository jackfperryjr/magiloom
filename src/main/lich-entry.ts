import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { pbkdf2Sync, randomBytes, createCipheriv } from 'crypto'

// Reproduces Lich's `:standard` password cipher (lib/common/gui/password_cipher.rb)
// in Node so a `--login <Char> --headless` launch can self-authenticate without a
// master-password prompt: AES-256-CBC, key = PBKDF2-HMAC-SHA256(ACCOUNT.upcase, a
// fixed salt, 10 000 iterations, 32 bytes), output = base64(iv[16] + ciphertext).
// Lich re-derives the identical key from the account name at login, so it decrypts
// unattended. NOTE: this is obfuscation, not real protection — the key comes only
// from the (semi-public) account name plus a salt hardcoded in Lich's open source.
function standardEncrypt(password: string, account: string): string {
  const key = pbkdf2Sync(account.toUpperCase(), 'lich5-password-encryption-standard', 10_000, 32, 'sha256')
  const iv  = randomBytes(16)
  const c   = createCipheriv('aes-256-cbc', key, iv)   // PKCS7 padding matches Ruby's OpenSSL default
  return Buffer.concat([iv, c.update(password, 'utf8'), c.final()]).toString('base64')
}

// Double-quoted YAML scalar with the two escapes YAML requires.
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Write Lich's saved-login file at `<dataDir>/entry.yaml` so that
 * `lich --login <Char> --headless=<port>` can authenticate with no frontend and no
 * game key forwarded from us. The password is stored with Lich's `:standard` cipher
 * (masked, not human-readable) — Lich decrypts it from the account name at login.
 * game_code is DR (this app is DR-only). File is written 0600.
 */
export function writeLichEntry(dataDir: string, account: string, password: string, charName: string): void {
  const acct = account.trim().toUpperCase()
  const char = charName.trim().replace(/^(.)(.*)$/, (_m, a: string, b: string) => a.toUpperCase() + b.toLowerCase())
  const yaml =
`# Lich 5 Login Entries - YAML Format
encryption_mode: standard
master_password_validation_test:
accounts:
  ${yamlQuote(acct)}:
    password: ${yamlQuote(standardEncrypt(password, acct))}
    characters:
    - char_name: ${yamlQuote(char)}
      game_code: "DR"
      game_name: "DragonRealms"
      frontend: "stormfront"
      custom_launch:
      custom_launch_dir:
      is_favorite: false
`
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'entry.yaml'), yaml, { mode: 0o600 })
}
