export interface GeologicalUnit {
  unit_id: number;
  strat_name: string;
  lith: string;
  age_top: number;
  age_bottom: number;
  thickness: number;
  color: string;
  description: string;
}

export interface GeologicalColumn {
  col_id: number;
  name: string;
  lat: number;
  lng: number;
  units: GeologicalUnit[];
}

export interface GeologyLayerDef {
  name: string;
  depthTop: number;
  depthBottom: number;
  color: string;
  opacity: number;
  lith: string;
}
