import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type LabelDocument = HydratedDocument<Label>;

// A business label (VEG-697). A household marks money as business by pointing
// a Transaction, RecurringTransaction or Goal at one of these; no label means
// personal. Household-scoped like every budgeting record.
@Schema({ timestamps: true })
export class Label {
  // Resolved server-side by HouseholdGuard, never trusted from the client.
  // No standalone index: label_name_unique below has householdId as its
  // prefix, so household-scoped reads use that.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Household',
    required: true,
  })
  householdId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // A #rrggbb hex color for chips and chart series.
  @Prop({ required: true })
  color: string;

  // Archived labels keep their references and stay usable in filters, but
  // cannot be assigned to new records.
  @Prop({ required: true, default: false })
  isArchived: boolean;

  // Unused by the UI for now. The business report rolls up over it from day
  // one, so sub-businesses need no migration later.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Label' })
  parentId?: MongooseSchema.Types.ObjectId;
}

export const LabelSchema = SchemaFactory.createForClass(Label);

// One label per name in a household, compared case-insensitively. The
// strength-2 collation makes "Business" and "business" collide. A query only
// uses this index when it asks for the same collation, which is why the list
// sorts with LABEL_NAME_COLLATION too. Explicit name for the same reason as
// recurring_occurrence_unique on Transaction: buildAllIndexes fails loudly on a
// conflict instead of leaving the constraint unenforced.
export const LABEL_NAME_COLLATION = { locale: 'en', strength: 2 };

LabelSchema.index(
  { householdId: 1, name: 1 },
  {
    unique: true,
    name: 'label_name_unique',
    collation: LABEL_NAME_COLLATION,
  },
);
