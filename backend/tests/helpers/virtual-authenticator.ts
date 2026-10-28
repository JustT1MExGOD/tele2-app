/**
 * 20.85.0 — a software WebAuthn authenticator for tests: a real ES256
 * keypair that produces cryptographically valid attestation/assertion
 * responses @simplewebauthn/server's verify*Response() accepts. This is the
 * piece the suite was missing — previously only boundary cases (malformed
 * input, wrong-credential-id, "not configured") were covered; the real
 * happy path and the wrong-signature/wrong-challenge/wrong-rpId negative
 * paths were untested end-to-end.
 *
 * It is NOT a hand-rolled fake that bypasses verification — it signs with
 * Node's crypto over the exact wire format the spec requires
 * (authData || sha256(clientDataJSON)), so the assertions it makes are
 * real ones the server actually checks.
 */
import { createHash, generateKeyPairSync, sign as cryptoSign, randomBytes } from 'crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

// COSE constants (mirroring @simplewebauthn/server's cose.ts):
const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;
const COSE_KEYS = { kty: 1, alg: 3, crv: -1, x: -2, y: -3 } as const;

const FLAG_UP = 0x01;   // user present
const FLAG_UV = 0x04;   // user verified
const FLAG_AT = 0x40;   // attested credential data present

function sha256(b: Buffer | Uint8Array | string): Buffer {
  return createHash('sha256').update(b as any).digest();
}

/** Export an EC P-256 public key's JWK x/y as raw 32-byte coordinates. */
function ecPublicKeyToCoords(jwk: { x: string; y: string }): { x: Buffer; y: Buffer } {
  return { x: Buffer.from(jwk.x, 'base64url'), y: Buffer.from(jwk.y, 'base64url') };
}

/**
 * The authenticator: holds one credential (keypair + credential ID) and can
 * mint registration attestationObjects and assertion responses.
 */
export class VirtualAuthenticator {
  readonly credentialId: Buffer;
  get credentialIdB64url(): string { return isoBase64URL.fromBuffer(this.credentialId); }
  private readonly privateKey: any;
  readonly publicKeyJwk: { x: string; y: string };
  private counter = 0;
  private readonly aaguid = Buffer.alloc(16, 0);

  constructor(privateKey: any, publicKeyJwk: { x: string; y: string }, credentialId: Buffer) {
    this.privateKey = privateKey;
    this.publicKeyJwk = publicKeyJwk;
    this.credentialId = credentialId;
  }

  static create(credentialId?: Buffer): VirtualAuthenticator {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    return new VirtualAuthenticator(
      privateKey,
      { x: jwk.x, y: jwk.y },
      credentialId ?? randomBytes(32)
    );
  }

  /** COSE public key: {1:2(EC2), 3:-7(ES256), -1:1(P-256), -2:x, -3:y}. */
  private cosePublicKey(): Buffer {
    const { x, y } = ecPublicKeyToCoords(this.publicKeyJwk);
    const map = new Map<number, any>([
      [COSE_KEYS.kty, COSE_KTY_EC2],
      [COSE_KEYS.alg, COSE_ALG_ES256],
      [COSE_KEYS.crv, COSE_CRV_P256],
      [COSE_KEYS.x, new Uint8Array(x)],
      [COSE_KEYS.y, new Uint8Array(y)]
    ]);
    return Buffer.from(encodeCBOR(map));
  }

  /** authenticatorData: rpIdHash || flags || counter || [attestedCredData]. */
  private authData(opts: { rpId: string; attested: boolean; userVerified?: boolean }): Buffer {
    const rpIdHash = sha256(opts.rpId);
    let flags = FLAG_UP;
    if (opts.userVerified !== false) flags |= FLAG_UV;
    if (opts.attested) flags |= FLAG_AT;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.counter);
    const parts: Buffer[] = [rpIdHash, Buffer.from([flags]), counter];
    if (opts.attested) {
      const credIdLen = Buffer.alloc(2);
      credIdLen.writeUInt16BE(this.credentialId.length);
      parts.push(this.aaguid, credIdLen, this.credentialId, this.cosePublicKey());
    }
    return Buffer.concat(parts);
  }

  private clientDataJSON(opts: { type: 'webauthn.create' | 'webauthn.get'; challenge: string; origin: string }): Buffer {
    return Buffer.from(JSON.stringify({
      type: opts.type,
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false
    }));
  }

  /**
   * registration attestationObject — CBOR {fmt:'none', attStmt:{}, authData}
   * for attestationType:'none' (the app's configured type), which the server
   * accepts with no attestation signature.
   */
  attestation(opts: { rpId: string; challenge: string; origin: string; userVerified?: boolean }) {
    const authData = this.authData({ rpId: opts.rpId, attested: true, userVerified: opts.userVerified });
    const attestationObject = Buffer.from(encodeCBOR(new Map<string, any>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', new Uint8Array(authData)]
    ])));
    const clientDataJSON = this.clientDataJSON({ type: 'webauthn.create', challenge: opts.challenge, origin: opts.origin });
    return {
      id: this.credentialIdB64url,
      rawId: this.credentialIdB64url,
      type: 'public-key' as const,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal' as const]
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const
    };
  }

  /**
   * assertion — real ECDSA signature over authData || sha256(clientDataJSON),
   * DER-encoded (what WebCrypto/Node produce and verify* expects).
   */
  assertion(opts: { rpId: string; challenge: string; origin: string; userVerified?: boolean; wrongKey?: VirtualAuthenticator }) {
    const authData = this.authData({ rpId: opts.rpId, attested: false, userVerified: opts.userVerified });
    const clientDataJSON = this.clientDataJSON({ type: 'webauthn.get', challenge: opts.challenge, origin: opts.origin });
    const signatureBase = Buffer.concat([authData, sha256(clientDataJSON)]);
    const signer = opts.wrongKey ?? this;
    const signature = cryptoSign('sha256', signatureBase, signer.privateKey);
    return {
      id: this.credentialIdB64url,
      rawId: this.credentialIdB64url,
      type: 'public-key' as const,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
        userHandle: isoBase64URL.fromBuffer(randomBytes(32))
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const
    };
  }
}

export { isoBase64URL };
