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

const Field = z.string().max(MAX_DISPLAY_FIELD);

/**
 * A structure to draw beside a tool's answer, never shown to the model: its
 * idCode (with coordinates), SMILES or molfile, an optional 3D molfile, and
 * what its card is named by.
 */
export const DisplayMoleculeSchema = z.object({
  idCode: Field.optional(),
  coordinates: Field.optional(),
  smiles: Field.optional(),
  molfile: Field.optional(),
  molfile3D: Field.optional(),
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
 * A text file a tool produced, offered as it is with copy and download.
 */
export const DisplayFileSchema = z.object({
  fileName: z.string().min(1),
  format: z.string(),
  content: Field,
});

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
 * A file offered beside a tool's answer.
 */
export type DisplayFile = z.infer<typeof DisplayFileSchema>;
