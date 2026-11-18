// Entry point for the vendored Qubic crypto bundle embedded in index.html.
// Re-exports only the official @qubic.org/crypto + @qubic.org/tx APIs the wallet uses.
export {
  k12,
  deriveKeys,
  publicKeyToIdentity,
  identityToPublicKey,
  isValidIdentityChecksum,
  sign,
  verify,
  generateRandomSeed,
} from '@qubic.org/crypto'
export {
  buildTransaction,
  signTransaction,
  encodeTransaction,
  decodeTransaction,
  computeTransactionHash,
  verifyTransactionSignature,
} from '@qubic.org/tx'
// Argon2id (RFC 9106) for the encrypted local vault — same KDF family/params as the official @qubic.org/vault.
export { argon2idAsync } from '@noble/hashes/argon2.js'
// Message signing (SchnorrQ over a message of any length, as the official wallet's FourQlib build signs messages):
// the same package version's FourQ point functions and group order, re-exported from its own sources. The
// transaction path above keeps using the published dist build unchanged.
export { scalarBaseMult, pointMarshal, pointUnmarshal, doubleScalarMult } from './node_modules/@qubic.org/crypto/src/fourq.ts'
// Point validation for message verification: rejects public keys off the curve or of small order (cofactor 392).
export { pointIdentity, pointDouble, pointAdd, toR2, isOnCurve } from './node_modules/@qubic.org/crypto/src/fourq.ts'
export { ORDER as SCHNORRQ_ORDER } from './node_modules/@qubic.org/crypto/src/schnorrq.ts'
