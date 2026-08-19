import type { FoodbClient } from "./foodb";
import type { UsdaClient } from "./usda";

/** Both DBs hit with enough compounds to leaf. */
export function stubChemistryClients(onSearch?: (name: string) => void): {
  usda: UsdaClient;
  foodb: FoodbClient;
} {
  return {
    usda: {
      search: async (name) => {
        onSearch?.(name);
        return { id: name, name };
      },
      compounds: async () => [{ id: "sodium", amount: 1200 }],
    },
    foodb: {
      search: async (name) => ({ id: name, name }),
      compounds: async () => [{ id: "glutamate", amount: 100 }],
    },
  };
}
