import { expect, it } from "vitest";
import { operatorCargoWeightText } from "./operatorCargoWeight";
const basis = (cargo_units: unknown[]) => ({schema_version:1,title:"Recette fictive",revision_no:1,calculated_at:"2026-11-06T00:00:00Z",source_run_id:"synthetic",scope_hash:"a".repeat(64),scope:{cargo_units},assumptions:[],overlay:[],reservations:[],open_points:[]});
it("presents retained kg per unit and an explicitly derived per-lot total without mutating its source", () => {
 const source = basis([{unit_ref:"lot-test",quantity:20,gross_weight_kg:28000,weight_basis:"per_unit"}]);
 const saved = JSON.stringify(source), text = operatorCargoWeightText(source).join(" ");
 expect(text).toMatch(/28\s000 kg par unité × 20/); expect(text).toMatch(/560\s000 kg \(560 tonnes\)/); expect(text).toContain("calculé depuis ces bases");
 expect(JSON.stringify(source)).toBe(saved);
});
it("never multiplies a total weight or sums independent lots", () => {
 const text = operatorCargoWeightText(basis([{unit_ref:"a",quantity:20,gross_weight_kg:560000,weight_basis:"total"},{unit_ref:"b",quantity:2,gross_weight_kg:1000,weight_basis:"total"}]));
 expect(text).toHaveLength(2); expect(text[0]).toContain("560 tonnes"); expect(text[1]).toContain("1 tonnes"); expect(text.join(" ")).not.toContain("561");
});
it.each([null,undefined,-1,NaN,Infinity,"28000"])("keeps unknown/invalid saved weights unknown (%s)", gross_weight_kg => {
 expect(operatorCargoWeightText(basis([{gross_weight_kg,quantity:20,weight_basis:"per_unit"}]))[0]).toContain("poids brut non précisé");
});
it.each([null,0,-1,1.5,Infinity,"20"])("does not manufacture a total from an unknown/invalid quantity (%s)",quantity=>{
 const text=operatorCargoWeightText(basis([{quantity,gross_weight_kg:28000,weight_basis:"per_unit"}]))[0];expect(text).toContain("quantité non précisée");expect(text).not.toContain("560");
});
it("keeps zero, unknown weight basis and overflow explicit",()=>{
 expect(operatorCargoWeightText(basis([{quantity:20,gross_weight_kg:0,weight_basis:"per_unit"}]))[0]).toContain("0 kg (0 tonnes)");
 expect(operatorCargoWeightText(basis([{quantity:20,gross_weight_kg:28000,weight_basis:"unknown"}]))[0]).toContain("base par unité ou total du lot non précisée");
 expect(operatorCargoWeightText(basis([{quantity:20,gross_weight_kg:Number.MAX_VALUE,weight_basis:"per_unit"}]))[0]).toContain("poids total du lot non établi");
});
it("absence stays legacy, malformed presence fails instead of guessing",()=>{
 expect(operatorCargoWeightText(undefined)).toEqual([]); expect(()=>operatorCargoWeightText(null)).toThrow();expect(()=>operatorCargoWeightText({scope:{cargo_units:[]}})).toThrow();
});

it("does not present an unsafe finite product as an exact total",()=>{
 const text=operatorCargoWeightText(basis([{quantity:20,gross_weight_kg:Number.MAX_SAFE_INTEGER,weight_basis:"per_unit"}]))[0];expect(text).toContain("poids total du lot non établi");expect(text).not.toContain("calculé depuis ces bases");
});

it("does not round a recorded fractional kg value to zero tonnes",()=>{
 const text=operatorCargoWeightText(basis([{quantity:1,gross_weight_kg:0.4,weight_basis:"total"}]))[0];expect(text).toContain("0,4 kg (0,0004 tonnes)");
});
