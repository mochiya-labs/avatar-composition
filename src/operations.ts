// Runtime-only evaluation records. These are not the extension wire format.
import type {
	Condition,
	CompositionComponent,
	RemapCurve,
	Selector,
} from "./schema.js";
type Common = {
	id: string;
	componentId: string;
	sourceOrder: number;
	condition?: Condition;
};
export type Operation = Common &
	(
		| {
				type: "morph.sync";
				driver: Selector;
				driven: Selector;
				curve?: RemapCurve;
		  }
		| { type: "morph.override"; target: Selector; value: number }
		| { type: "node.active"; target: Selector; value: boolean }
		| {
				type: "material.swap";
				target: Selector;
				slot: number;
				material: number;
		  }
	);
export function operations(
	component: CompositionComponent,
	sourceOrder: number,
): Operation[] {
	const common = {
		componentId: component.id,
		sourceOrder,
		condition: "condition" in component ? component.condition : undefined,
	};
	switch (component.type) {
		case "shapeChanger":
			return component.shapes.map((s, i) => ({
				...common,
				id: `${component.id}/${i}`,
				type: "morph.override",
				target: s.target,
				value: s.changeType === "delete" ? 0 : s.value,
			}));
		case "blendshapeSync":
			return component.bindings.map((b, i) => ({
				...common,
				...b,
				id: `${component.id}/${i}`,
				type: "morph.sync",
			}));
		case "objectToggle":
			return component.objects.map((o, i) => ({
				...common,
				...o,
				id: `${component.id}/${i}`,
				type: "node.active",
			}));
		case "materialSetter":
			return component.objects.map((o, i) => ({
				...common,
				...o,
				id: `${component.id}/${i}`,
				type: "material.swap",
			}));
		case "menuItem":
			return component.automatic
				? [true, false].map((active) => ({
						...common,
						id: `${component.id}/${active}`,
						type: "node.active",
						target: { asset: "self", node: component.sourceNode },
						value: active,
						condition: {
							type: "control",
							control: component.parameter ?? component.id,
							value: component.value,
							inverse: !active,
						},
					}))
				: [];
		default:
			return [];
	}
}
