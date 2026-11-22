import { CLASSES, EDGE_TYPES } from "./graph-model";
import type { GraphDocument } from "./graph-document";

/**
 * A small product graph for a 5 HP induction motor, so the product features
 * have something to show before any engineering file is imported. Parts and
 * numbers follow the sample STEP files PMem shipped with
 * (000678–000687, PMem/backend/STP).
 */
export const DEMO_MOTOR_GRAPH: GraphDocument = {
  format: "SEED",
  name: "Demo: 5 HP induction motor",
  nodes: [
    { key: "000687", name: "INDUCTION MOTOR ASSY 5HP", className: CLASSES.ASSEMBLY, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000687", revision: "A" } },
    { key: "ROTOR-ASSY", name: "Rotor Assembly", className: CLASSES.ASSEMBLY, sourceTag: "PRODUCT", rflpLayer: "P" },
    { key: "000684", name: "Rotor Shaft Machined", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000684", revision: "B", material: "AISI 4140" } },
    { key: "000678", name: "SKF 6306-2Z Bearing", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000678", revision: "A", quantity: 2 } },
    { key: "000681", name: "External Circlip", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000681", revision: "A" } },
    { key: "000683", name: "Centrifugal Fan", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000683", revision: "A" } },
    { key: "000682", name: "Laminated Stator Core", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000682", revision: "A" } },
    { key: "000685", name: "Coil for Three Phase Winding", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000685", revision: "A" } },
    { key: "000679", name: "End Bell Machined", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000679", revision: "A" } },
    { key: "000686", name: "Terminal Box Machined", className: CLASSES.PART, sourceTag: "PRODUCT", rflpLayer: "P", properties: { partNumber: "000686", revision: "A" } },
    { key: "REQ-001", name: "Shaft runout within 0.02 mm", className: CLASSES.REQUIREMENT, sourceTag: "Requirement", rflpLayer: "R", properties: { catalogueId: "REQ-001" } },
    { key: "REQ-002", name: "IP55 enclosure", className: CLASSES.REQUIREMENT, sourceTag: "Requirement", rflpLayer: "R", properties: { catalogueId: "REQ-002" } },
    { key: "FN-TORQUE", name: "Transmit torque to load", className: "Function", sourceTag: "Function", rflpLayer: "F" },
    { key: "OP-TURN", name: "Turn and grind shaft", className: CLASSES.PROCESS, sourceTag: "Operation", rflpLayer: "P" },
    { key: "OP-WIND", name: "Wind stator coils", className: CLASSES.PROCESS, sourceTag: "Operation", rflpLayer: "P" },
    { key: "ECR-1001", name: "ECR-1001 Increase shaft diameter at bearing seat", className: CLASSES.CHANGE_REQUEST, sourceTag: "ChangeRequest", properties: { revision: "A" } },
  ],
  edges: [
    { from: "000687", to: "ROTOR-ASSY", type: EDGE_TYPES.HAS_CHILD },
    { from: "000687", to: "000682", type: EDGE_TYPES.HAS_CHILD },
    { from: "000687", to: "000685", type: EDGE_TYPES.HAS_CHILD },
    { from: "000687", to: "000679", type: EDGE_TYPES.HAS_CHILD, properties: { quantity: 2 } },
    { from: "000687", to: "000686", type: EDGE_TYPES.HAS_CHILD },
    { from: "ROTOR-ASSY", to: "000684", type: EDGE_TYPES.HAS_CHILD },
    { from: "ROTOR-ASSY", to: "000678", type: EDGE_TYPES.HAS_CHILD, properties: { quantity: 2 } },
    { from: "ROTOR-ASSY", to: "000681", type: EDGE_TYPES.HAS_CHILD },
    { from: "ROTOR-ASSY", to: "000683", type: EDGE_TYPES.HAS_CHILD },
    { from: "000684", to: "REQ-001", type: EDGE_TYPES.SATISFIES },
    { from: "000686", to: "REQ-002", type: EDGE_TYPES.SATISFIES },
    { from: "000679", to: "REQ-002", type: EDGE_TYPES.SATISFIES },
    { from: "000684", to: "FN-TORQUE", type: EDGE_TYPES.REALIZES },
    { from: "ECR-1001", to: "000684", type: EDGE_TYPES.CHANGE_AFFECTS, properties: { role: "impacted" } },
    { from: "ECR-1001", to: "000678", type: EDGE_TYPES.CHANGE_AFFECTS, properties: { role: "impacted" } },
  ],
};
