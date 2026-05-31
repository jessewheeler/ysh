#!/usr/bin/env bash
# DNS propagation checker for yellowstoneseahawkers.org

DOMAIN="yellowstoneseahawkers.org"
TARGET_NS="dns1.registrar-servers.com"
TARGET_A="ysh-cmbz.onrender.com"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}~${NC} $1"; }

echo ""
echo "DNS check: $DOMAIN  ($(date '+%H:%M:%S'))"
echo "─────────────────────────────────────────"

# Nameservers
NS=$(dig "$DOMAIN" NS +short | sort)
echo ""
echo "NAMESERVERS"
if echo "$NS" | grep -q "$TARGET_NS"; then
  ok "Namecheap NS active"
  echo "$NS" | sed 's/^/    /'
else
  fail "Still on old nameservers — propagation pending"
  echo "$NS" | sed 's/^/    /'
fi

# A record
echo ""
echo "A / APEX"
A=$(dig "$DOMAIN" A +short)
if [ -z "$A" ]; then
  warn "No A record (expected if using CNAME/ALIAS at apex)"
else
  fail "A record present: $A  ← should be removed if using CNAME @"
fi

# CNAME @ (Namecheap serves this as ALIAS — resolves directly)
APEX=$(dig "$DOMAIN" +short | tail -1)
if [ "$APEX" = "$(dig $TARGET_A +short | tail -1)" ]; then
  ok "Apex resolves to Render  ($APEX)"
else
  fail "Apex not yet pointing to Render  (got: ${APEX:-none})"
fi

# www
echo ""
echo "WWW"
WWW=$(dig "www.$DOMAIN" +short | tail -1)
RENDER=$(dig "$TARGET_A" +short | tail -1)
if [ "$WWW" = "$RENDER" ]; then
  ok "www → Render  ($WWW)"
else
  fail "www not yet pointing to Render  (got: ${WWW:-none})"
fi

# MX
echo ""
echo "MAIL"
MX=$(dig "$DOMAIN" MX +short)
if echo "$MX" | grep -q "mailersend\|eforward"; then
  ok "MX records present"
  echo "$MX" | sed 's/^/    /'
else
  fail "MX not set  (got: ${MX:-none})"
fi

# SPF
SPF=$(dig "$DOMAIN" TXT +short | grep "v=spf1")
if echo "$SPF" | grep -q "mailersend"; then
  ok "SPF includes MailerSend"
else
  warn "SPF missing or not yet propagated  (got: ${SPF:-none})"
fi

# MailerSend DKIM
echo ""
echo "MAILERSEND"
DKIM=$(dig "mlsend2._domainkey.$DOMAIN" CNAME +short)
if echo "$DKIM" | grep -q "mailersend"; then
  ok "DKIM CNAME active  ($DKIM)"
else
  fail "DKIM CNAME not propagated  (got: ${DKIM:-none})"
fi

MTA=$(dig "mta.$DOMAIN" CNAME +short)
if echo "$MTA" | grep -q "mailersend"; then
  ok "MTA CNAME active  ($MTA)"
else
  fail "MTA CNAME not propagated  (got: ${MTA:-none})"
fi

echo ""
echo "─────────────────────────────────────────"
echo "Re-run to track propagation progress."
echo ""
