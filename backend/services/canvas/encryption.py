import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_key() -> bytes:
    raw = os.environ.get('CANVAS_PAT_ENCRYPTION_KEY', '')
    if not raw:
        raise ValueError(
            'CANVAS_PAT_ENCRYPTION_KEY environment variable is not set'
        )
    return base64.b64decode(raw)


def encrypt_pat(raw_pat: str) -> str:
    key = _get_key()
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, raw_pat.encode('utf-8'), None)
    return base64.b64encode(nonce + ciphertext).decode('ascii')


def decrypt_pat(token: str) -> str:
    key = _get_key()
    payload = base64.b64decode(token)
    nonce, ciphertext = payload[:12], payload[12:]
    return AESGCM(key).decrypt(nonce, ciphertext, None).decode('utf-8')


def mask_pat(raw_pat: str) -> str:
    if len(raw_pat) <= 8:
        return '****'
    return raw_pat[:6] + '****' + raw_pat[-4:]
