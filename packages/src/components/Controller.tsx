import "@/globals.css";

import { Keyboard, MousePointer2 } from "lucide-react";

import AdBanner from "@/components/controller/AdBanner";
import ControllerFooter from "@/components/controller/ControllerFooter";
import CursorSettingsTab from "@/components/controller/CursorSettingsTab";
import KeyboardSettingsTab from "@/components/controller/KeyboardSettingsTab";
import { useControllerSettings } from "@/components/controller/useControllerSettings";
import TitleBar from "@/components/TitleBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import packageJson from "../../package.json";

export default function Controller() {
  const { settings, displays, setSetting, resetSettings } =
    useControllerSettings();

  return (
    <>
      <TitleBar />

      <div className="pointer-events-auto z-999 h-70 overflow-hidden p-4">
        <Tabs defaultValue="cursor" className="w-full">
          <TabsList className="z-999 grid w-full grid-cols-2">
            <TabsTrigger value="cursor">
              <MousePointer2 className="mr-2 h-4 w-4" />
              커서 설정
            </TabsTrigger>
            <TabsTrigger value="keyboard">
              <Keyboard className="mr-2 h-4 w-4" />
              키보드 설정
            </TabsTrigger>
          </TabsList>
          <TabsContent value="cursor">
            <CursorSettingsTab settings={settings} onSettingChange={setSetting} />
          </TabsContent>
          <TabsContent value="keyboard">
            <KeyboardSettingsTab
              settings={settings}
              displays={displays}
              onSettingChange={setSetting}
            />
          </TabsContent>
        </Tabs>
      </div>

      <ControllerFooter version={packageJson.version} onReset={resetSettings} />
      <AdBanner />
    </>
  );
}
