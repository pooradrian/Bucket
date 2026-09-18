#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace aesgcm {

constexpr std::size_t AES256_KEY_LEN = 32;
constexpr std::size_t GCM_NONCE_LEN = 12;
constexpr std::size_t GCM_TAG_LEN = 16;

std::vector<uint8_t> aes256GcmEncrypt(const uint8_t key[AES256_KEY_LEN],
                                      const uint8_t nonce[GCM_NONCE_LEN],
                                      const uint8_t* plaintext, std::size_t plaintextLen,
                                      uint8_t tag[GCM_TAG_LEN]);

bool aes256GcmDecrypt(const uint8_t key[AES256_KEY_LEN],
                      const uint8_t nonce[GCM_NONCE_LEN],
                      const uint8_t* ciphertext, std::size_t ciphertextLen,
                      const uint8_t tag[GCM_TAG_LEN],
                      std::vector<uint8_t>& out);

}
