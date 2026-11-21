import { z } from "zod";

/**
 * PMem's recommender responses, parsed at the boundary and renamed into
 * SAINT's camelCase. The analysis itself (scoring, traversal depth) stays in
 * PMem; this side only decides what the result looks like to a caller.
 *
 * Every list defaults to empty: PMem omits keys rather than sending `[]` on
 * some of its "nothing found" paths.
 */

const optionalText = z.string().nullish().transform((v) => v ?? null);

/* ----------------------------- change impact ----------------------------- */

export const pmemChangeImpactSchema = z
  .object({
    change_entity: z
      .object({
        name: z.string(),
        source_tag: optionalText,
        revision: optionalText,
        elementId: optionalText,
      })
      .nullish(),
    impacted_parts: z
      .array(
        z.object({
          name: z.string(),
          source_tag: optionalText,
          relation_type: optionalText,
          class_name: optionalText,
        })
      )
      .default([]),
    assembly_impact: z
      .array(
        z.object({
          assembly_name: z.string(),
          depth: z.number().default(0),
          from_part: optionalText,
        })
      )
      .default([]),
    impacted_requirements: z
      .array(
        z.object({
          name: z.string(),
          catalogue_id: optionalText,
          linked_part: optionalText,
        })
      )
      .default([]),
    process_impacts: z
      .array(
        z.object({
          name: z.string(),
          link_type: optionalText,
          source_tag: optionalText,
          from_part: optionalText,
        })
      )
      .default([]),
    impact_score: z.number().default(0),
    message: optionalText,
  })
  .transform((r) => ({
    changeEntity: r.change_entity
      ? {
          name: r.change_entity.name,
          sourceTag: r.change_entity.source_tag,
          revision: r.change_entity.revision,
          id: r.change_entity.elementId,
        }
      : null,
    impactScore: r.impact_score,
    impactedParts: r.impacted_parts.map((p) => ({
      name: p.name,
      sourceTag: p.source_tag,
      relation: p.relation_type,
      className: p.class_name,
    })),
    affectedAssemblies: r.assembly_impact.map((a) => ({
      assembly: a.assembly_name,
      depth: a.depth,
      viaPart: a.from_part,
    })),
    affectedRequirements: r.impacted_requirements.map((q) => ({
      name: q.name,
      catalogueId: q.catalogue_id,
      linkedPart: q.linked_part,
    })),
    affectedProcesses: r.process_impacts.map((p) => ({
      name: p.name,
      linkType: p.link_type,
      sourceTag: p.source_tag,
      viaPart: p.from_part,
    })),
    message: r.message,
  }));

export type ChangeImpact = z.output<typeof pmemChangeImpactSchema>;

/* ----------------------------- similar parts ----------------------------- */

export const pmemSimilarPartsSchema = z
  .object({
    source_part: z
      .object({
        name: z.string(),
        source_tag: optionalText,
        rflp_layer: optionalText,
      })
      .nullish(),
    similar_parts: z
      .array(
        z.object({
          name: z.string(),
          source_tag: optionalText,
          rflp_layer: optionalText,
          similarity_score: z.number(),
          shared_assembly: z.boolean().default(false),
        })
      )
      .default([]),
    message: optionalText,
  })
  .transform((r) => ({
    sourcePart: r.source_part
      ? { name: r.source_part.name, sourceTag: r.source_part.source_tag, layer: r.source_part.rflp_layer }
      : null,
    similarParts: r.similar_parts.map((p) => ({
      name: p.name,
      sourceTag: p.source_tag,
      layer: p.rflp_layer,
      /** 0–100, PMem's weighted blend of source, RFLP layer, assembly and name overlap. */
      score: p.similarity_score,
      sharedAssembly: p.shared_assembly,
    })),
    message: r.message,
  }));

export type SimilarParts = z.output<typeof pmemSimilarPartsSchema>;
