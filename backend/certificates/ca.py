
from datetime import datetime, timedelta, timezone
import os
import tempfile

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric import padding

from config import CERT_DIR


CA_KEY_PATH = CERT_DIR / "packetsniff-ca.key"
CA_CERT_PATH = CERT_DIR / "packetsniff-ca.crt"


def _secure_directory():
    CERT_DIR.mkdir(parents=True, exist_ok=True)

    # Restrict directory access on platforms that support POSIX permissions.
    if os.name != "nt":
        os.chmod(CERT_DIR, 0o700)


def _validate_ca():
    """Validate that the Root CA certificate and private key match."""

    if not CA_KEY_PATH.exists() or not CA_CERT_PATH.exists():
        raise RuntimeError(
            "Root CA files are incomplete. "
            "Manual recovery or regeneration is required."
        )

    try:
        private_key = serialization.load_pem_private_key(
            CA_KEY_PATH.read_bytes(),
            password=None,
        )

        certificate = x509.load_pem_x509_certificate(
            CA_CERT_PATH.read_bytes()
        )

        if not isinstance(private_key, rsa.RSAPrivateKey):
            raise ValueError("Root CA private key is not RSA.")

        if not isinstance(certificate.public_key(), rsa.RSAPublicKey):
            raise ValueError("Root CA certificate does not contain an RSA key.")

        if (
            private_key.public_key().public_numbers()
            != certificate.public_key().public_numbers()
        ):
            raise ValueError("Root CA certificate and private key do not match.")

        if certificate.subject != certificate.issuer:
            raise ValueError("Root CA certificate is not self-issued.")

        constraints = certificate.extensions.get_extension_for_class(
            x509.BasicConstraints
        ).value

        if not constraints.ca:
            raise ValueError("Certificate is not a CA certificate.")

        now = datetime.now(timezone.utc)

        # Updated UTC-aware properties to avoid deprecation warnings.
        if certificate.not_valid_before_utc > now:
            raise ValueError("Root CA certificate is not valid yet.")

        if certificate.not_valid_after_utc <= now:
            raise ValueError("Root CA certificate has expired.")

        # Verify the self-signed certificate signature.
        certificate.public_key().verify(
            certificate.signature,
            certificate.tbs_certificate_bytes,
            padding.PKCS1v15(),
            certificate.signature_hash_algorithm,
        )

        if os.name != "nt":
            os.chmod(CA_KEY_PATH, 0o600)

        print("[CA] Existing Root CA validated successfully.")

        return True

    except Exception as exc:
        raise RuntimeError(
            f"Root CA validation failed: {exc}"
        ) from exc


def _write_temp_file(data: bytes, prefix: str, private: bool = False):
    """Write a temporary file in the certificate directory."""

    fd, temp_path = tempfile.mkstemp(
        dir=CERT_DIR,
        prefix=prefix,
    )

    try:
        if private and os.name != "nt":
            os.chmod(temp_path, 0o600)

        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())

        return temp_path

    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass

        if os.path.exists(temp_path):
            os.unlink(temp_path)

        raise


def generate_ca():
    """
    Create a unique local Root CA on first launch.

    Reuse a valid existing CA.
    Never silently replace an incomplete or invalid CA.
    """

    _secure_directory()

    key_exists = CA_KEY_PATH.exists()
    cert_exists = CA_CERT_PATH.exists()

    # Existing CA: validate and reuse.
    if key_exists and cert_exists:
        _validate_ca()
        return CA_CERT_PATH, CA_KEY_PATH

    # Partial CA: do not silently create a different identity.
    if key_exists != cert_exists:
        raise RuntimeError(
            "Only one Root CA file exists. "
            "PacketSniffer requires both the certificate and private key. "
            "Use the certificate recovery process."
        )

    print("[CA] First launch: generating a new Root CA...")

    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=3072,
    )

    subject = x509.Name([
        x509.NameAttribute(
            NameOID.COMMON_NAME,
            "PacketSniffer Local Root CA",
        ),
        x509.NameAttribute(
            NameOID.ORGANIZATION_NAME,
            "PacketSniffer",
        ),
    ])

    now = datetime.now(timezone.utc)

    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(
            x509.BasicConstraints(
                ca=True,
                path_length=0,
            ),
            critical=True,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=False,
                key_cert_sign=True,
                crl_sign=True,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(
                private_key.public_key()
            ),
            critical=False,
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(
                private_key.public_key()
            ),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    private_key_data = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    certificate_data = certificate.public_bytes(
        serialization.Encoding.PEM
    )

    key_temp = None
    cert_temp = None

    try:
        key_temp = _write_temp_file(
            private_key_data,
            "ca-key-",
            private=True,
        )

        cert_temp = _write_temp_file(
            certificate_data,
            "ca-cert-",
        )

        # Place the private key first, then its matching certificate.
        os.replace(key_temp, CA_KEY_PATH)
        key_temp = None

        os.replace(cert_temp, CA_CERT_PATH)
        cert_temp = None

        if os.name != "nt":
            os.chmod(CA_KEY_PATH, 0o600)

    finally:
        for temp_path in (key_temp, cert_temp):
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    _validate_ca()

    print("[CA] New Root CA generated successfully.")
    print(f"[CA] Public certificate: {CA_CERT_PATH}")

    return CA_CERT_PATH, CA_KEY_PATH
