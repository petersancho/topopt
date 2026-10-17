import { create } from 'zustand';
import {type Config,preset} from './model';
export const useStore=create<{config:Config;set:(patch:Partial<Config>)=>void;replace:(c:Config)=>void}>((set)=>({config:preset(),set:patch=>set(s=>({config:{...s.config,...patch}})),replace:config=>set({config})}));
