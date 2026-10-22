import { z } from 'zod';

/**
 * Characters kept at most in one field of a structure, a scheme or a file.
 */
export const MAX_DISPLAY_FIELD = 2_000_000;
/**
 * Structure cards drawn at most for one tool call.
 */
export const MAX_MOLECULES = 12;
/**
 * Measurements drawn at most on one structure.
 */
export const MAX_MEASUREMENTS = 12;
/**
 * Reaction schemes drawn at most for one tool call.
 */
export const MAX_REACTIONS = 4;
/**
 * Spectra drawn at most for one tool call.
 */
export const MAX_SPECTRA = 8;
/**
 * Files offered at most for one tool call.
 */
export const MAX_FILES = 8;
/**
 * Curves drawn at most for one tool call.
 */
export const MAX_CURVES = 8;
/**
 * Points kept at most on one curve.
 */
export const MAX_CURVE_POINTS = 100_000;

const Field = z.string().max(MAX_DISPLAY_FIELD);

/**
 * A measurement the answer states, drawn on the structure's 3D model: two
 * atoms for a distance, three for an angle, four for a dihedral angle, as
 * zero-based indices into the atoms of the molecule's `molfile3D`.
 */
export const DisplayMeasurementSchema = z.object({
  atoms: z.array(z.number().int().min(0)).min(2).max(4),
});

/**
 * A structure to draw beside a tool's answer, never shown to the model: its
 * idCode (with coordinates), SMILES or molfile, an optional 3D molfile with
 * the measurements to draw on it, and what its card is named by. A malformed
 * list of measurements is dropped, never the structure.
 */
export const DisplayMoleculeSchema = z.object({
  idCode: Field.optional(),
  coordinates: Field.optional(),
  smiles: Field.optional(),
  molfile: Field.optional(),
  molfile3D: Field.optional(),
  measurements: z
    .array(DisplayMeasurementSchema)
    .max(MAX_MEASUREMENTS)
    .optional()
    .catch(undefined),
  label: Field.optional(),
});

/**
 * A reaction scheme to draw: OpenChemLib's ReactionEncoder string.
 */
export const DisplayReactionSchema = z.object({
  rxnCode: Field.min(1),
  label: Field.optional(),
});

/**
 * A spectrum to draw: evenly spaced points from `from` to `to` in ppm.
 */
export const DisplaySpectrumSchema = z.object({
  nucleus: z.string().min(1),
  frequency: z.number().positive(),
  from: z.number(),
  to: z.number(),
  y: z.array(z.number()),
});

/**
 * One axis of a curve: what it measures, how the readout names a value, and
 * the values themselves.
 */
export const DisplayCurveAxisSchema = z.object({
  /**
   * What the axis measures, with its unit, e.g. `Volume of HCl added (mL)`.
   */
  title: z.string().min(1),
  /**
   * What the readout names a value by, e.g. `V` or `pH`.
   */
  symbol: z.string(),
  /**
   * The unit the readout writes after a value, e.g. `mL`.
   */
  unit: z.string().optional(),
  /**
   * How many decimals the readout writes.
   */
  decimals: z.number().int().min(0).max(12),
  /**
   * One value per point.
   */
  values: z.array(z.number()).max(MAX_CURVE_POINTS),
  /**
   * The range shown when the curve is fitted, e.g. `[0, 14]` for a pH.
   */
  range: z.tuple([z.number(), z.number()]).optional(),
});

/**
 * A curve to draw, such as a titration curve: one y value per x value, the x
 * values ascending.
 */
export const DisplayCurveSchema = z
  .object({
    title: z.string().min(1),
    x: DisplayCurveAxisSchema,
    y: DisplayCurveAxisSchema,
  })
  .refine((curve) => curve.x.values.length === curve.y.values.length, {
    message: 'a curve has one y value per x value',
  });

/**
 * A text file a tool produced, offered as it is with copy and download.
 */
export const DisplayFileSchema = z.object({
  fileName: z.string().min(1),
  format: z.string(),
  content: Field,
});

/**
 * A measurement drawn on a structure's 3D model.
 */
export type DisplayMeasurement = z.infer<typeof DisplayMeasurementSchema>;
/**
 * A structure to draw beside a tool's answer.
 */
export type DisplayMolecule = z.infer<typeof DisplayMoleculeSchema>;
/**
 * A reaction scheme to draw beside a tool's answer.
 */
export type DisplayReaction = z.infer<typeof DisplayReactionSchema>;
/**
 * A spectrum to draw beside a tool's answer.
 */
export type DisplaySpectrum = z.infer<typeof DisplaySpectrumSchema>;
/**
 * One axis of a curve drawn beside a tool's answer.
 */
export type DisplayCurveAxis = z.infer<typeof DisplayCurveAxisSchema>;
/**
 * A curve drawn beside a tool's answer.
 */
export type DisplayCurve = z.infer<typeof DisplayCurveSchema>;
/**
 * A file offered beside a tool's answer.
 */
export type DisplayFile = z.infer<typeof DisplayFileSchema>;
