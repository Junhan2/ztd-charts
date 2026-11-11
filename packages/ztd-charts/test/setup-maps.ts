// 테스트는 ztd-charts/server처럼 내장 지도를 모두 등록하고 시작해요 (예시와 변형 스펙의 지도가 "등록 안 됨"으로 막히지 않게).
// 등록하지 않은 경우는 choropleth.test.tsx가 등록표를 잠깐 비워서 봐요
import { krSido } from "../src/geo/kr-sido";
import { registerMap } from "../src/geo/registry";
import { usStates } from "../src/geo/us-states";
import { world } from "../src/geo/world";

registerMap(world, usStates, krSido);
