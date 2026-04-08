

# Fix Build Error — Missing CardContent wrapper in ExternalRequestsPanel

## Problem

Lines 238-987 (PartnerSuggestionPanel, create form, request list) sit between `</CardHeader>` (L237) and `</CardContent>` (L988), but there is no opening `<CardContent>` tag. The JSX tree is malformed.

## Fix

Add `<CardContent className="space-y-3">` immediately after line 237 (`</CardHeader>`), before the PartnerSuggestionPanel at line 238.

**Single edit in `src/components/puzzle/ExternalRequestsPanel.tsx`:**

Line 237-238, change:
```tsx
      </CardHeader>
        {/* COCKPIT-5: Partner suggestions */}
```
to:
```tsx
      </CardHeader>
      <CardContent className="space-y-3">
        {/* COCKPIT-5: Partner suggestions */}
```

This matches the existing `</CardContent>` at line 988. No other file changes needed.

