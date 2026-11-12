// Tests start with every built-in map registered, like ztd-charts/server (so the maps in example and variant specs are not blocked as "not registered").
// The unregistered case is covered by choropleth.test.tsx, which briefly empties the registry
import { krSido } from "../src/geo/kr-sido";
import { registerMap } from "../src/geo/registry";
import { usStates } from "../src/geo/us-states";
import { world } from "../src/geo/world";

registerMap(world, usStates, krSido);
