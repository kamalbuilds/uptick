# Uptick LOI templates

Two one page templates. Both are non-binding. Neither commits funds, exclusivity, or a fee. Fill, sign, countersign, keep a PDF at the path shown.

## Holder deposit intent

Use after an interview when the person gives an honest size and a condition. Send the same day.

```
HOLDER DEPOSIT INTENT (NON-BINDING)

Date: ____________________

Holder name or handle: ____________________
Contact: ____________________
Wallet or entity (optional): ____________________

Token: NVDA / GOOGL / other Stock Token on Robinhood Chain (chain 4663)
Indicative size: ____________________ USDG equivalent, or ____________________ token units
Target vault: Uptick [token] vault

Conditions:
1. Mainnet vault deployed at a published address: ____________________
2. Minimum kept APR over the measurement window: ____________________ %
3. Measurement window: ____________________
4. Audit status required: ____________________
5. Deposit cap and exit terms: ____________________
6. Other: ____________________

I intend to consider a deposit of the size above into the Uptick [token] vault if
the conditions are met. This is an expression of intent only. It is non-binding,
and no funds are committed, transferred, or escrowed. I may change or withdraw
this intent at any time. Uptick makes no promise of yield or return.

Holder signature: ____________________
Name: ____________________
Date: ____________________

Uptick countersignature (acknowledgement, not a promise): ____________________
Name: ____________________
Date: ____________________
```

Store at `gtm/uptick/lois/holder/<handle>-<YYYY-MM-DD>.pdf`. The count in `EVIDENCE.md` is the number of signed PDFs in that folder.

## Ecosystem integration intent

Use when a project agrees to a specific integration, not when they say they like the product.

```
ECOSYSTEM INTEGRATION INTENT (NON-BINDING)

Date: ____________________

Protocol: ____________________
Their owner (name, role, contact): ____________________
Uptick owner: ____________________

Integration (check one or more):
[ ] List Uptick vaults in your product
[ ] Read the Uptick evidence API
[ ] Read the Uptick MCP tools list_vaults and get_vault_evidence
[ ] Route USDG deposits through UptickRouter when live
[ ] Show Uptick kept APR as a comparator row
[ ] Use the Uptick share price feed as collateral

Scope: ____________________

What the protocol gets: ____________________

Target date: ____________________

Dependencies: mainnet vault address, audit status, API uptime, legal review

This is an expression of intent only. It is non-binding. No funds are committed,
no exclusivity is granted, and no fee is owed. Either party may stop at any time.
Each party remains responsible for its own product, users, and compliance.

Protocol signature: ____________________
Name: ____________________
Role: ____________________
Date: ____________________

Uptick signature: ____________________
Name: ____________________
Role: ____________________
Date: ____________________
```

Store at `gtm/uptick/lois/integration/<project>-<YYYY-MM-DD>.pdf`. The count in `EVIDENCE.md` is the number of signed PDFs in that folder.
