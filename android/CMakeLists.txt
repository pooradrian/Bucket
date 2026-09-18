cmake_minimum_required(VERSION 3.13)

project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

add_library(
  NitroCrypto
  SHARED
  ../cpp/cpp-adapter.cpp
  ../cpp/AesGcm.cpp
  ../cpp/HybridNativeCrypto.cpp
)

set_target_properties(
  NitroCrypto
  PROPERTIES
  CXX_STANDARD 20
  CXX_STANDARD_REQUIRED ON
  CXX_EXTENSIONS OFF
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroCrypto+autolinking.cmake)

include_directories(../cpp)

find_library(LOG_LIB log)

target_link_libraries(NitroCrypto ${LOG_LIB} android)

target_compile_options(
  NitroCrypto
  PRIVATE
  -fexceptions
  -frtti
  -fstack-protector-all
  -O2
  -Wall
)
