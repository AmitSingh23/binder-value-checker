import { describe, expect, test } from "bun:test";
import { parseLine } from "./parse";

describe("parseLine", () => {
  test("plain lines are unchanged", () => {
    expect(parseLine("2x Charizard 4/102 LP")).toEqual({
      raw: "2x Charizard 4/102 LP", qty: 2, cond: "LP", name: "Charizard", number: "4", total: "102", set: null,
    });
    expect(parseLine("Charizard, 004/102 x2 (MP)")).toMatchObject({ qty: 2, cond: "MP", name: "Charizard", number: "004" });
    expect(parseLine("Mew TG12/TG30")).toMatchObject({ name: "Mew", number: "TG12", total: "TG30" });
  });

  test("reads a set code anywhere after the name", () => {
    expect(parseLine("Pikachu ex 238/191 set:SSP")).toMatchObject({ name: "Pikachu ex", number: "238", total: "191", set: "SSP" });
    expect(parseLine("Pikachu ex 238/191 set:ssp LP")).toMatchObject({ set: "SSP", cond: "LP" });
    expect(parseLine("2x Gengar 94/165 MP set: MEW")).toMatchObject({ qty: 2, cond: "MP", set: "MEW" });
    expect(parseLine("Gengar set:MEW 94/165")).toMatchObject({ name: "Gengar", number: "94", set: "MEW" });
  });

  test("a set code alone isn't a card number", () => {
    expect(parseLine("Gengar set:MEW")).toHaveProperty("error");
  });

  test("names containing 'set' are left alone", () => {
    expect(parseLine("Sunset Pikachu 5/10")).toMatchObject({ name: "Sunset Pikachu", set: null });
  });
});
