import ExpoModulesCore

public class BleMeshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BleMesh")

    Events("onChange")

    Function("hello") {
      return "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { (value: String) in
      self.sendEvent("onChange", [
        "value": value
      ])
    }
  }
}
