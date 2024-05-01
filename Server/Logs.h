#pragma once

#include <stdint.h>

#define RR_DISCORD_WEBHOOK_URL                                                 \
"https://discord.com/api/webhooks/1222558683192496238/-BM7mTbeISTMQaVucW6yZDKMElP7Xd1TOWIAH-hUo5ggHCdJaVm7ZI3PcCOcElnXCNCD"

void rr_discord_webhook_log(char *webhook_name, char *name, char *value,
                            uint32_t color);

#ifdef RR_DISABLE_DISCORD_INTEGRATION
#define rr_discord_webhook_log(a, b, c)
#endif
