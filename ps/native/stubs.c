// SPDX-License-Identifier: AGPL-3.0-only
// Stand-ins for the parts of chiaki-ng's library VI Translator leaves out: Remote Play over the
// internet (PSN hole punching, which needs curl, json-c and miniupnpc) and the certificate
// fetching (AIA) that goes with it. Play on the home network never reaches them.

#include <chiaki/common.h>
#include <chiaki/remote/holepunch.h>

#include <string.h>

ChiakiErrorCode chiaki_aia_init(void) { return CHIAKI_ERR_SUCCESS; }
void chiaki_aia_fini(void) {}

ChiakiErrorCode chiaki_holepunch_session_punch_hole(ChiakiHolepunchSession session, ChiakiHolepunchPortType port_type)
{
	(void)session;
	(void)port_type;
	return CHIAKI_ERR_UNKNOWN;
}

void chiaki_holepunch_session_fini(ChiakiHolepunchSession session) { (void)session; }

ChiakiErrorCode holepunch_session_create_offer(ChiakiHolepunchSession session)
{
	(void)session;
	return CHIAKI_ERR_UNKNOWN;
}

ChiakiHolepunchRegistInfo chiaki_get_regist_info(ChiakiHolepunchSession session)
{
	(void)session;
	ChiakiHolepunchRegistInfo info;
	memset(&info, 0, sizeof(info));
	return info;
}

void chiaki_get_ps_selected_addr(ChiakiHolepunchSession session, char *ps_ip)
{
	(void)session;
	if(ps_ip)
		ps_ip[0] = 0;
}

uint16_t chiaki_get_ps_ctrl_port(ChiakiHolepunchSession session)
{
	(void)session;
	return 0;
}

chiaki_socket_t *chiaki_get_holepunch_sock(ChiakiHolepunchSession session, ChiakiHolepunchPortType type)
{
	(void)session;
	(void)type;
	return NULL;
}
