# @pharmacy/shared-domain

Domain model shared by `apps/api`, `apps/web` and `apps/admin` (`type:domain`: depends on nothing applied).

- `permissions` — the permission catalog `<module>:<action>` and special permissions (ADR-0018);
  `hasPermissions`, `exceedingPermissions` (escalation check), `isPermission`.
- `checkPin`, `isTrivialPin` — PIN policy of terminal sign-in (ADR-0008).
- `bestDiscount`, `nextDiscount`, `returnRefund` — discount rules by threshold and the refund with
  the discount recalculated on a customer return (amounts in dirams).
- `pieceCost`, `suggestRetail`, `markupOf`, `priceDeviation`, `stockState` — prices and states of stock
  documents (cost of a piece rounded up).
- `roleTemplates` — the four role templates copied into a new tenant (owner is a system role).

`npx nx test shared-domain` — unit tests (Jest).
