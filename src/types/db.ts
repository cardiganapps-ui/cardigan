/* Ergonomic aliases over the generated Supabase schema types.
   Import these instead of reaching into Database['public']['Tables'][…]
   by hand. The generated source (./supabase) is regenerated from the
   live schema after every migration; these aliases are the stable public
   surface the app imports.

   Usage:
     import type { Tables, TablesInsert } from "../types/db";
     function priceOf(s: Tables<"sessions">) { return s.rate ?? 0; }
     const row: TablesInsert<"payments"> = { user_id, amount, … };

   Adopt incrementally — typing a hook's rows against Tables<"…"> turns a
   schema change that breaks that hook into a compile error. */

import type { Database } from "./supabase";

type PublicSchema = Database["public"];

/** Row shape (what a SELECT returns) for a public table. */
export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

/** Insert shape (optional defaults/nullable) for a public table. */
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

/** Update shape (all-optional) for a public table. */
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

/** A public enum's union type. */
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];
