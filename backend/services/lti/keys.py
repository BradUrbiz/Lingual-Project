"""
RSA key management for LTI 1.3 JWT signing.

Loads an RSA private key from the LTI_RSA_PRIVATE_KEY environment variable.
Falls back to generating an ephemeral 2048-bit key for development.
"""

import base64
import hashlib
import os
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@lru_cache(maxsize=1)
def get_private_key():
    """Load or generate the RSA private key used for LTI JWT signing.

    Reads PEM-encoded key from ``LTI_RSA_PRIVATE_KEY`` env var.  When the
    variable is absent (local dev), generates an ephemeral 2048-bit key.
    """
    pem_env = os.environ.get('LTI_RSA_PRIVATE_KEY', '').strip()
    if pem_env:
        return serialization.load_pem_private_key(pem_env.encode(), password=None)

    # Ephemeral key for development — not persisted across restarts.
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def get_private_key_pem():
    """Export the private key as a PEM-encoded string."""
    key = get_private_key()
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _int_to_base64url(n):
    """Convert a positive integer to a Base64url-encoded string (no padding)."""
    byte_length = (n.bit_length() + 7) // 8
    raw = n.to_bytes(byte_length, byteorder='big')
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def get_public_key_jwk():
    """Return the public key as a JWK dict suitable for a JWKS endpoint."""
    key = get_private_key()
    pub = key.public_key()
    pub_numbers = pub.public_numbers()

    # Deterministic kid derived from the public key DER.
    der = pub.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    kid = hashlib.sha256(der).hexdigest()[:16]

    return {
        'kty': 'RSA',
        'alg': 'RS256',
        'use': 'sig',
        'kid': kid,
        'n': _int_to_base64url(pub_numbers.n),
        'e': _int_to_base64url(pub_numbers.e),
    }


def get_jwks():
    """Return a JWKS document containing the tool's public key."""
    return {'keys': [get_public_key_jwk()]}
