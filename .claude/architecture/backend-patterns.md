# Backend Coding Patterns

## Mongoose Filter Type Casting

When passing filter objects to Mongoose query methods (`.find()`, `.deleteMany()`, `.updateMany()`), cast them as `Record<string, unknown>` to satisfy `tsc`'s strict overload resolution. This is required because Mongoose's TypeScript types do not handle `ObjectId` or MongoDB `$` operators correctly in filter objects.

```typescript
// Correct — works in both tsc and ts-jest
this.model.find({ userId: new Types.ObjectId(id) } as Record<string, unknown>)
this.model.deleteMany({ userId: new Types.ObjectId(id) } as Record<string, unknown>)

// Incorrect — compiles in ts-jest but fails in tsc (nest start --watch)
this.model.find({ userId: new Types.ObjectId(id) })
```

### Why this matters

`ts-jest` (used by `npm test`) is more lenient with TypeScript type checking than `tsc` (used by `nest start --watch`). Code can pass all unit tests but fail to compile in the dev server. **Always verify the dev server compiles cleanly after making backend changes** — check for `Found 0 errors` in the watch output.
