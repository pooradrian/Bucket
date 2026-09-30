#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "../../cpp/AesGcm.hpp"

namespace {

struct Vector {
  size_t length;
  const char* ciphertext;
  const char* tag;
};

std::string toHex(const uint8_t* data, size_t length) {
  static const char digits[] = "0123456789abcdef";
  std::string out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 0x0f]);
  }
  return out;
}

int failures = 0;

void expect(bool ok, size_t length, const char* what) {
  if (ok) {
    return;
  }
  failures++;
  printf("FAIL len %zu: %s\n", length, what);
}

}

int main() {
  const Vector vectors[] = {
      {0, "", "530f8afbc74536b9a963b4f1c4cb738b"},
      {1, "8f", "f29cf0c10636ba8916a6fd48b640c026"},
      {15, "8fe6017c0c212a2f460f8492fbb2dc", "386dc60e9391b2013cf403d4445258e3"},
      {16, "8fe6017c0c212a2f460f8492fbb2dc59", "c04ec1e8d75951c6e58d4b6cff53c745"},
      {17, "8fe6017c0c212a2f460f8492fbb2dc5933", "5a5324db6454c2488a7a563270f4e25c"},
      {32,
       "8fe6017c0c212a2f460f8492fbb2dc593321428b76e76b3590e3b4cf344774cf",
       "e36485f2be586ba0ac6e8b5f23dffda3"},
      {60,
       "8fe6017c0c212a2f460f8492fbb2dc593321428b76e76b3590e3b4cf344774cf9c0bf0690c0ba03a00a9186"
       "5064d77b606008aa0c0fa3e71203d5ca2",
       "786a9c2c38b05870b8eb98e48a602e96"},
  };

  uint8_t key[aesgcm::AES256_KEY_LEN] = {};
  uint8_t nonce[aesgcm::GCM_NONCE_LEN] = {};

  for (const Vector& vector : vectors) {
    const std::vector<uint8_t> plaintext(vector.length, 0x41);
    uint8_t tag[aesgcm::GCM_TAG_LEN];
    const std::vector<uint8_t> ciphertext =
        aesgcm::aes256GcmEncrypt(key, nonce, plaintext.data(), plaintext.size(), tag);
    expect(toHex(ciphertext.data(), ciphertext.size()) == vector.ciphertext, vector.length, "ciphertext");
    expect(toHex(tag, sizeof(tag)) == vector.tag, vector.length, "tag");

    std::vector<uint8_t> decrypted;
    const bool authenticated = aesgcm::aes256GcmDecrypt(
        key, nonce, ciphertext.data(), ciphertext.size(), tag, decrypted);
    expect(authenticated, vector.length, "decrypt accepted valid tag");
    expect(decrypted == plaintext, vector.length, "round trip");

    uint8_t tamperedTag[aesgcm::GCM_TAG_LEN];
    std::memcpy(tamperedTag, tag, sizeof(tag));
    tamperedTag[0] ^= 1;
    std::vector<uint8_t> rejected;
    const bool acceptedTampered = aesgcm::aes256GcmDecrypt(
        key, nonce, ciphertext.data(), ciphertext.size(), tamperedTag, rejected);
    expect(!acceptedTampered, vector.length, "decrypt accepted tampered tag");
  }

  printf("%zu vectors checked, %d failures\n", sizeof(vectors) / sizeof(vectors[0]), failures);
  return failures == 0 ? 0 : 1;
}
