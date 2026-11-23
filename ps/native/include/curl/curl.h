/* VI Translator builds chiaki-ng's library for play on the home network only: without curl (used
 * by chiaki-ng for Remote Play over the internet). Its headers only name curl's handle type. */
#ifndef VIT_CURL_STUB_H
#define VIT_CURL_STUB_H
typedef void CURL;
#endif
