import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_CONTEXT = 'harness-kanban:github-token'
const ENCRYPTION_VERSION = 'v1'
const IV_LENGTH_BYTES = 12

const buildEncryptionKey = (secret: string) => {
  const normalizedSecret = secret.trim()
  if (!normalizedSecret) {
    throw new Error('BETTER_AUTH_SECRET must be configured to encrypt GitHub tokens.')
  }

  return createHash('sha256').update(`${ENCRYPTION_CONTEXT}:${normalizedSecret}`).digest()
}

export const encryptGithubToken = (token: string, secret: string): string => {
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, buildEncryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export const decryptGithubToken = (payload: string, secret: string): string => {
  const [version, ivEncoded, authTagEncoded, encryptedEncoded] = payload.split(':')
  if (version !== ENCRYPTION_VERSION || !ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error('GitHub token payload is invalid.')
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    buildEncryptionKey(secret),
    Buffer.from(ivEncoded, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64url'))

  return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, 'base64url')), decipher.final()]).toString('utf8')
}
