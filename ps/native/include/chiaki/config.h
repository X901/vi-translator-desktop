/* chiaki-ng's lib/config.h.in, as VI Translator builds it: no Opus (the app decodes the sound
 * itself), no FFmpeg or Raspberry Pi decoder (the app decodes the picture itself). */
#ifndef CHIAKI_CONFIG_H
#define CHIAKI_CONFIG_H
#define CHIAKI_LIB_ENABLE_OPUS 0
#define CHIAKI_LIB_ENABLE_PI_DECODER 0
#define CHIAKI_LIB_ENABLE_FFMPEG_DECODER 0
#endif
