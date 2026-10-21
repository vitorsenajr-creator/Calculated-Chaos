# Trash for deleted items (v3.26.0)

Deleting an item no longer destroys it. It moves to the business's `trash`
collection for 30 days, and can be restored from Settings → Data → Trash.

## What happens on delete

- **Item with no active eBay listing**: a confirmation, then the item moves
  to the trash.
- **Item with an active eBay listing** (`ebayListingId` set, not ended): the
  app asks first, in `ui/items/delete-dialog.js`:
  - *Remove from eBay and delete* (default): ends the listing through
    `api/ebay-end-listing.js` (`withdrawOffer`), then trashes the item. If
    eBay doesn't confirm, nothing is deleted and the question returns with
    the reason.
  - *Delete only in the app*: trashes the item and leaves the eBay listing
    live. The warning says so.
  - *Keep item*: cancels.
  - An item with a listing ID but no offer ID can't be ended by the app. It
    gets the "end it on eBay first" question.
- **Bulk delete**: one confirmation for the batch, then the eBay question per
  item that has a listing. A kept item is skipped and the rest continue.
- **Undo import** (Settings → Data → Past imports): moves the import's items
  to the trash. It doesn't end eBay listings; the result says how many items
  are still listed on eBay.

## The trash record

`trash/{id}` holds the whole item plus:

| Field | Meaning |
| --- | --- |
| `deletedAt` | When it was deleted (Timestamp). |
| `deletedBy` | `{ uid, email }` of the person who deleted it. |
| `expiresAt` | `deletedAt` + 30 days (Timestamp). |
| `removedFromEbayAt` | Set only when the delete ended the eBay listing. |

Move and restore each commit in one batch, so an item is never in both
collections or in neither. Batches hold 200 items (two writes each).

## Restore

The trash fields are removed. If `removedFromEbayAt` is set, the eBay listing
fields are removed too and `ebay` leaves `listedPlatforms`, so the item comes
back unlisted. The status is kept. If another item has the same product code,
the restore says so and does not block.

## Expiry

The list removes records past `expiresAt` when it opens. A Firestore TTL
policy on `trash.expiresAt` can do the same without the list, but it's
optional: the list never shows an expired record.

## Rules

`trash` is a member collection (`isMemberData` in `firestore.rules`). Until the
updated rules are pasted into the Firebase Console, members can't read or
write the trash.
