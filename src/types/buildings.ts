export interface BuildingData {
  id: number;
  geometry: Array<[number, number]>;
  properties: {
    height?: number;
    levels?: number;
    name?: string;
    type?: string;
    roof_shape?: string;
  };
}
