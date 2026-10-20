"""
AegisCare 360 - KMS Security & Envelope Encryption Module
Applies AWS Key Management Service (KMS) encryption to sensitive personal health data,
family passphrases, and emergency contact phone numbers.
Includes software-based fallback for local offline testing when AWS credentials are not configured.
"""

import os
import base64
import json
from typing import Optional, Tuple, Dict, Any

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
    HAVE_BOTO3 = True
except ImportError:
    HAVE_BOTO3 = False

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAVE_CRYPTO = True
except ImportError:
    HAVE_CRYPTO = False


class KMSSecurityService:
    """Provides envelope encryption and field-level encryption for sensitive PII."""

    def __init__(self, key_id: Optional[str] = None, region_name: str = "us-east-1"):
        self.key_id = key_id or os.environ.get("AEGISCARE_KMS_KEY_ID")
        self.region_name = region_name or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        self.kms_client = None
        self._local_fallback_key = None

        if HAVE_BOTO3:
            try:
                self.kms_client = boto3.client("kms", region_name=self.region_name)
            except Exception:
                self.kms_client = None

        # Setup local key for mock/fallback mode
        if HAVE_CRYPTO:
            self._local_fallback_key = AESGCM.generate_key(bit_length=256)

    def encrypt_field(self, plaintext: str, context: Optional[Dict[str, str]] = None) -> str:
        """
        Encrypts a sensitive plaintext string (e.g. phone number, family passphrase).
        Returns base64 encoded ciphertext string.
        """
        if not plaintext:
            return ""

        encryption_context = context or {"application": "AegisCare360"}

        # Attempt AWS KMS direct/envelope encryption if available and key configured
        if self.kms_client and self.key_id:
            try:
                response = self.kms_client.encrypt(
                    KeyId=self.key_id,
                    Plaintext=plaintext.encode("utf-8"),
                    EncryptionContext=encryption_context,
                )
                ciphertext_blob = response["CiphertextBlob"]
                # Prefix with 'kms:' tag to identify KMS-managed ciphertext
                return "kms:" + base64.b64encode(ciphertext_blob).decode("utf-8")
            except (ClientError, NoCredentialsError) as e:
                # Log and fallback to local AES-256-GCM mock
                pass

        # Fallback to local AES-256-GCM encryption for local mock/hackathon testing
        if HAVE_CRYPTO and self._local_fallback_key:
            aesgcm = AESGCM(self._local_fallback_key)
            nonce = os.urandom(12)
            aad = json.dumps(encryption_context, sort_keys=True).encode("utf-8")
            ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), aad)
            payload = nonce + ciphertext
            return "local_aesgcm:" + base64.b64encode(payload).decode("utf-8")

        # Basic obfuscation fallback if cryptography library is unavailable
        return "mock_enc:" + base64.b64encode(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt_field(self, ciphertext: str, context: Optional[Dict[str, str]] = None) -> str:
        """
        Decrypts an encrypted field back to plaintext string.
        """
        if not ciphertext:
            return ""

        encryption_context = context or {"application": "AegisCare360"}

        # 1. AWS KMS Decryption
        if ciphertext.startswith("kms:"):
            raw_b64 = ciphertext[4:]
            ciphertext_blob = base64.b64decode(raw_b64)
            if self.kms_client:
                try:
                    response = self.kms_client.decrypt(
                        CiphertextBlob=ciphertext_blob,
                        EncryptionContext=encryption_context,
                    )
                    return response["Plaintext"].decode("utf-8")
                except Exception as e:
                    return f"[DECRYPTION_ERROR: {e}]"
            return "[KMS_CLIENT_NOT_AVAILABLE]"

        # 2. Local AES-256-GCM Decryption
        if ciphertext.startswith("local_aesgcm:"):
            raw_b64 = ciphertext[13:]
            payload = base64.b64decode(raw_b64)
            nonce = payload[:12]
            ct = payload[12:]
            if HAVE_CRYPTO and self._local_fallback_key:
                aesgcm = AESGCM(self._local_fallback_key)
                aad = json.dumps(encryption_context, sort_keys=True).encode("utf-8")
                plaintext_bytes = aesgcm.decrypt(nonce, ct, aad)
                return plaintext_bytes.decode("utf-8")
            return "[CRYPTO_KEY_UNAVAILABLE]"

        # 3. Mock fallback
        if ciphertext.startswith("mock_enc:"):
            raw_b64 = ciphertext[9:]
            return base64.b64decode(raw_b64).decode("utf-8")

        # If plain string passed
        return ciphertext
