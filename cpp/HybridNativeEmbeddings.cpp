#include "HybridNativeEmbeddings.hpp"

#include <dlfcn.h>
#include <sys/stat.h>

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "llama.h"

namespace margelo::nitro::crypto {

namespace {

constexpr const char* LIB_NAMES[] = {
    "libggml-base.so",
    "libggml-cpu.so",
    "libggml.so",
    "libllama.so",
};

constexpr int32_t MAX_SEQUENCES = 8;

void silentLog(ggml_log_level, const char*, void*) {}

void* openLibrary(const std::string& dir, const char* name) {
  const std::string path = dir + "/" + name;
  chmod(path.c_str(), 0444);
  void* handle = dlopen(path.c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (handle == nullptr) {
    const char* reason = dlerror();
    throw std::runtime_error(
        std::string("NativeEmbeddings: cannot load ") + name + ": " +
        (reason != nullptr ? reason : "unknown error"));
  }
  return handle;
}

template <typename T>
T resolve(void* handle, const char* symbol) {
  dlerror();
  void* address = dlsym(handle, symbol);
  const char* reason = dlerror();
  if (address == nullptr || reason != nullptr) {
    throw std::runtime_error(
        std::string("NativeEmbeddings: missing symbol ") + symbol);
  }
  return reinterpret_cast<T>(address);
}

struct Api {
  decltype(&llama_backend_init) backendInit = nullptr;
  decltype(&llama_model_default_params) modelDefaultParams = nullptr;
  decltype(&llama_model_load_from_file) modelLoadFromFile = nullptr;
  decltype(&llama_model_free) modelFree = nullptr;
  decltype(&llama_model_get_vocab) modelGetVocab = nullptr;
  decltype(&llama_model_n_embd_out) modelNEmbdOut = nullptr;
  decltype(&llama_model_n_ctx_train) modelNCtxTrain = nullptr;
  decltype(&llama_model_desc) modelDesc = nullptr;
  decltype(&llama_model_has_encoder) modelHasEncoder = nullptr;
  decltype(&llama_model_has_decoder) modelHasDecoder = nullptr;
  decltype(&llama_context_default_params) contextDefaultParams = nullptr;
  decltype(&llama_init_from_model) initFromModel = nullptr;
  decltype(&llama_free) freeContext = nullptr;
  decltype(&llama_pooling_type) poolingType = nullptr;
  decltype(&llama_get_memory) getMemory = nullptr;
  decltype(&llama_memory_clear) memoryClear = nullptr;
  decltype(&llama_tokenize) tokenize = nullptr;
  decltype(&llama_batch_init) batchInit = nullptr;
  decltype(&llama_batch_free) batchFree = nullptr;
  decltype(&llama_decode) decode = nullptr;
  decltype(&llama_get_embeddings_seq) getEmbeddingsSeq = nullptr;
  decltype(&llama_get_embeddings_ith) getEmbeddingsIth = nullptr;
  decltype(&llama_log_set) logSet = nullptr;
};

void resolveAll(Api& api, void* llama) {
  api.backendInit = resolve<decltype(api.backendInit)>(llama, "llama_backend_init");
  api.modelDefaultParams = resolve<decltype(api.modelDefaultParams)>(llama, "llama_model_default_params");
  api.modelLoadFromFile = resolve<decltype(api.modelLoadFromFile)>(llama, "llama_model_load_from_file");
  api.modelFree = resolve<decltype(api.modelFree)>(llama, "llama_model_free");
  api.modelGetVocab = resolve<decltype(api.modelGetVocab)>(llama, "llama_model_get_vocab");
  api.modelNEmbdOut = resolve<decltype(api.modelNEmbdOut)>(llama, "llama_model_n_embd_out");
  api.modelNCtxTrain = resolve<decltype(api.modelNCtxTrain)>(llama, "llama_model_n_ctx_train");
  api.modelDesc = resolve<decltype(api.modelDesc)>(llama, "llama_model_desc");
  api.modelHasEncoder = resolve<decltype(api.modelHasEncoder)>(llama, "llama_model_has_encoder");
  api.modelHasDecoder = resolve<decltype(api.modelHasDecoder)>(llama, "llama_model_has_decoder");
  api.contextDefaultParams = resolve<decltype(api.contextDefaultParams)>(llama, "llama_context_default_params");
  api.initFromModel = resolve<decltype(api.initFromModel)>(llama, "llama_init_from_model");
  api.freeContext = resolve<decltype(api.freeContext)>(llama, "llama_free");
  api.poolingType = resolve<decltype(api.poolingType)>(llama, "llama_pooling_type");
  api.getMemory = resolve<decltype(api.getMemory)>(llama, "llama_get_memory");
  api.memoryClear = resolve<decltype(api.memoryClear)>(llama, "llama_memory_clear");
  api.tokenize = resolve<decltype(api.tokenize)>(llama, "llama_tokenize");
  api.batchInit = resolve<decltype(api.batchInit)>(llama, "llama_batch_init");
  api.batchFree = resolve<decltype(api.batchFree)>(llama, "llama_batch_free");
  api.decode = resolve<decltype(api.decode)>(llama, "llama_decode");
  api.getEmbeddingsSeq = resolve<decltype(api.getEmbeddingsSeq)>(llama, "llama_get_embeddings_seq");
  api.getEmbeddingsIth = resolve<decltype(api.getEmbeddingsIth)>(llama, "llama_get_embeddings_ith");
  api.logSet = resolve<decltype(api.logSet)>(llama, "llama_log_set");
}

const char* poolingName(enum llama_pooling_type type) {
  switch (type) {
    case LLAMA_POOLING_TYPE_MEAN:
      return "mean";
    case LLAMA_POOLING_TYPE_CLS:
      return "cls";
    case LLAMA_POOLING_TYPE_LAST:
      return "last";
    case LLAMA_POOLING_TYPE_RANK:
      return "rank";
    default:
      return "none";
  }
}

std::vector<llama_token> tokenizeText(const Api& api, const llama_model* model, const std::string& text) {
  const llama_vocab* vocab = api.modelGetVocab(model);
  int32_t count = -api.tokenize(vocab, text.c_str(), static_cast<int32_t>(text.size()), nullptr, 0, true, false);
  if (count <= 0) {
    return {};
  }
  std::vector<llama_token> tokens(static_cast<size_t>(count));
  count = api.tokenize(vocab, text.c_str(), static_cast<int32_t>(text.size()), tokens.data(), count, true, false);
  if (count <= 0) {
    return {};
  }
  tokens.resize(static_cast<size_t>(count));
  return tokens;
}

}

struct EmbeddingState {
  Api api;
  bool runtimeLoaded = false;
  llama_model* model = nullptr;
  llama_context* context = nullptr;
  enum llama_pooling_type pooling = LLAMA_POOLING_TYPE_NONE;
  int32_t dimensions = 0;
  int32_t contextSize = 0;
};

HybridNativeEmbeddings::HybridNativeEmbeddings()
    : HybridObject(TAG), state_(std::make_unique<EmbeddingState>()) {}

HybridNativeEmbeddings::~HybridNativeEmbeddings() {
  releaseLocked();
}

void HybridNativeEmbeddings::releaseLocked() {
  if (state_->context != nullptr) {
    state_->api.freeContext(state_->context);
    state_->context = nullptr;
  }
  if (state_->model != nullptr) {
    state_->api.modelFree(state_->model);
    state_->model = nullptr;
  }
  state_->dimensions = 0;
  state_->contextSize = 0;
  state_->pooling = LLAMA_POOLING_TYPE_NONE;
}

std::string HybridNativeEmbeddings::getAbi() {
#if defined(__aarch64__)
  return "arm64-v8a";
#elif defined(__arm__)
  return "armeabi-v7a";
#elif defined(__x86_64__)
  return "x86_64";
#elif defined(__i386__)
  return "x86";
#else
  return "unknown";
#endif
}

bool HybridNativeEmbeddings::getRuntimeLoaded() {
  std::lock_guard<std::mutex> lock(mutex_);
  return state_->runtimeLoaded;
}

std::shared_ptr<Promise<std::string>> HybridNativeEmbeddings::loadRuntime(const std::string& libDir) {
  return Promise<std::string>::async([this, libDir]() -> std::string {
    std::lock_guard<std::mutex> lock(mutex_);
    if (state_->runtimeLoaded) {
      return "ok";
    }
    void* llama = nullptr;
    for (const char* name : LIB_NAMES) {
      void* handle = openLibrary(libDir, name);
      if (std::string(name) == "libllama.so") {
        llama = handle;
      }
    }
    resolveAll(state_->api, llama);
    state_->api.logSet(&silentLog, nullptr);
    state_->api.backendInit();
    state_->runtimeLoaded = true;
    return "ok";
  });
}

std::shared_ptr<Promise<EmbeddingModelInfo>> HybridNativeEmbeddings::loadModel(const std::string& path, double threads, double contextSize) {
  return Promise<EmbeddingModelInfo>::async([this, path, threads, contextSize]() -> EmbeddingModelInfo {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!state_->runtimeLoaded) {
      throw std::runtime_error("NativeEmbeddings: runtime not loaded");
    }
    releaseLocked();

    llama_model_params modelParams = state_->api.modelDefaultParams();
    modelParams.n_gpu_layers = 0;
    modelParams.load_mode = LLAMA_LOAD_MODE_MMAP;

    state_->model = state_->api.modelLoadFromFile(path.c_str(), modelParams);
    if (state_->model == nullptr) {
      throw std::runtime_error("NativeEmbeddings: failed to load model " + path);
    }
    if (state_->api.modelHasEncoder(state_->model) && state_->api.modelHasDecoder(state_->model)) {
      state_->api.modelFree(state_->model);
      state_->model = nullptr;
      throw std::runtime_error("NativeEmbeddings: encoder-decoder models are not supported");
    }

    int32_t requested = static_cast<int32_t>(contextSize);
    if (requested < 32) {
      requested = 32;
    }
    const int32_t trained = state_->api.modelNCtxTrain(state_->model);
    if (trained > 0 && requested > trained) {
      requested = trained;
    }

    int32_t threadCount = static_cast<int32_t>(threads);
    if (threadCount < 1) {
      const unsigned int cores = std::thread::hardware_concurrency();
      threadCount = static_cast<int32_t>(std::clamp(cores / 2u, 1u, 4u));
    }

    llama_context_params contextParams = state_->api.contextDefaultParams();
    contextParams.embeddings = true;
    contextParams.n_ctx = requested;
    contextParams.n_batch = requested;
    contextParams.n_ubatch = requested;
    contextParams.n_seq_max = MAX_SEQUENCES;
    contextParams.n_threads = threadCount;
    contextParams.n_threads_batch = threadCount;
    contextParams.kv_unified = true;

    state_->context = state_->api.initFromModel(state_->model, contextParams);
    if (state_->context == nullptr) {
      state_->api.modelFree(state_->model);
      state_->model = nullptr;
      throw std::runtime_error("NativeEmbeddings: failed to create context");
    }

    state_->contextSize = requested;
    state_->dimensions = state_->api.modelNEmbdOut(state_->model);
    state_->pooling = state_->api.poolingType(state_->context);

    char description[256] = {0};
    state_->api.modelDesc(state_->model, description, sizeof(description));

    EmbeddingModelInfo info;
    info.dimensions = static_cast<double>(state_->dimensions);
    info.contextSize = static_cast<double>(state_->contextSize);
    info.description = std::string(description);
    info.pooling = std::string(poolingName(state_->pooling));
    return info;
  });
}

std::shared_ptr<Promise<std::vector<std::vector<double>>>> HybridNativeEmbeddings::embed(const std::vector<std::string>& texts) {
  return Promise<std::vector<std::vector<double>>>::async([this, texts]() -> std::vector<std::vector<double>> {
    std::lock_guard<std::mutex> lock(mutex_);
    if (state_->context == nullptr) {
      throw std::runtime_error("NativeEmbeddings: no model loaded");
    }
    const int32_t dimensions = state_->dimensions;
    const int32_t capacity = state_->contextSize;
    if (dimensions <= 0 || capacity <= 0) {
      throw std::runtime_error("NativeEmbeddings: invalid model state");
    }

    std::vector<std::vector<llama_token>> encoded(texts.size());
    for (size_t i = 0; i < texts.size(); ++i) {
      std::vector<llama_token> tokens = tokenizeText(state_->api, state_->model, texts[i]);
      if (tokens.empty()) {
        tokens = tokenizeText(state_->api, state_->model, " ");
      }
      if (tokens.empty()) {
        throw std::runtime_error("NativeEmbeddings: could not tokenize input");
      }
      if (static_cast<int32_t>(tokens.size()) > capacity) {
        tokens.resize(static_cast<size_t>(capacity));
      }
      encoded[i] = std::move(tokens);
    }

    std::vector<std::vector<double>> result(texts.size());
    size_t next = 0;
    while (next < encoded.size()) {
      llama_batch batch = state_->api.batchInit(capacity, 0, MAX_SEQUENCES);
      int32_t used = 0;
      int32_t sequences = 0;
      std::vector<int32_t> lengths;

      while (next < encoded.size() && sequences < MAX_SEQUENCES) {
        const std::vector<llama_token>& tokens = encoded[next];
        if (used + static_cast<int32_t>(tokens.size()) > capacity) {
          break;
        }
        for (size_t t = 0; t < tokens.size(); ++t) {
          batch.token[used] = tokens[t];
          batch.pos[used] = static_cast<llama_pos>(t);
          batch.n_seq_id[used] = 1;
          batch.seq_id[used][0] = static_cast<llama_seq_id>(sequences);
          batch.logits[used] = 1;
          ++used;
        }
        lengths.push_back(static_cast<int32_t>(tokens.size()));
        ++sequences;
        ++next;
      }

      batch.n_tokens = used;
      if (used == 0) {
        state_->api.batchFree(batch);
        throw std::runtime_error("NativeEmbeddings: input does not fit in context");
      }

      state_->api.memoryClear(state_->api.getMemory(state_->context), true);
      if (state_->api.decode(state_->context, batch) < 0) {
        state_->api.batchFree(batch);
        throw std::runtime_error("NativeEmbeddings: llama_decode failed");
      }

      const size_t base = next - static_cast<size_t>(sequences);
      int32_t offset = 0;
      for (int32_t s = 0; s < sequences; ++s) {
        std::vector<double> vector(static_cast<size_t>(dimensions));
        if (state_->pooling == LLAMA_POOLING_TYPE_NONE) {
          for (int32_t d = 0; d < dimensions; ++d) {
            vector[d] = 0;
          }
          for (int32_t t = 0; t < lengths[s]; ++t) {
            const float* token = state_->api.getEmbeddingsIth(state_->context, offset + t);
            if (token == nullptr) {
              state_->api.batchFree(batch);
              throw std::runtime_error("NativeEmbeddings: missing token embeddings");
            }
            for (int32_t d = 0; d < dimensions; ++d) {
              vector[d] += token[d];
            }
          }
          for (int32_t d = 0; d < dimensions; ++d) {
            vector[d] /= lengths[s];
          }
        } else {
          const float* sequence = state_->api.getEmbeddingsSeq(state_->context, s);
          if (sequence == nullptr) {
            state_->api.batchFree(batch);
            throw std::runtime_error("NativeEmbeddings: missing sequence embeddings");
          }
          for (int32_t d = 0; d < dimensions; ++d) {
            vector[d] = sequence[d];
          }
        }
        result[base + static_cast<size_t>(s)] = std::move(vector);
        offset += lengths[s];
      }

      state_->api.batchFree(batch);
      state_->api.memoryClear(state_->api.getMemory(state_->context), true);
    }

    return result;
  });
}

std::shared_ptr<Promise<void>> HybridNativeEmbeddings::releaseModel() {
  return Promise<void>::async([this]() {
    std::lock_guard<std::mutex> lock(mutex_);
    releaseLocked();
  });
}

}
